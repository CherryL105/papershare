const http = require("http");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const Busboy = require("busboy");
const { createRouter } = require("./router");
const { createServices } = require("./services");
const {
  convertElsevierXmlToHtml,
  fetchElsevierArticleSnapshotHtml,
  resolveElsevierApiKey,
} = require("./services/papers-service");
const { TABLES, createSqliteStore } = require("./storage/sqlite-store");
const {
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  getUserRole,
  isAdminUser,
  isDiscussionReply,
  isReplyAnnotation,
  normalizeMimeType,
  stripBackgroundImagesFromInlineStyle,
  supportsArticleImagesForSourceUrl,
  IMAGE_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  TABLE_ATTACHMENT_EXTENSIONS,
} = require("../../shared/papershare-shared");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = path.resolve(__dirname, "../..");
const CLIENT_DIST_DIR = path.join(ROOT_DIR, "dist");
loadEnvFile(path.join(ROOT_DIR, ".env"));
const STORAGE_DIR = resolveStorageDirectory(process.env.PAPERSHARE_STORAGE_DIR);
const HTML_DIR = path.join(STORAGE_DIR, "html");
const ATTACHMENTS_DIR = path.join(STORAGE_DIR, "attachments");
const PAPERS_FILE = path.join(STORAGE_DIR, "papers.json");
const ANNOTATIONS_FILE = path.join(STORAGE_DIR, "annotations.json");
const DISCUSSIONS_FILE = path.join(STORAGE_DIR, "discussions.json");
const USERS_FILE = path.join(STORAGE_DIR, "users.json");
const SESSIONS_FILE = path.join(STORAGE_DIR, "sessions.json");
const SESSION_COOKIE_NAME = "papershare_session";
const MAX_REQUEST_BODY_BYTES = 25 * 1024 * 1024;
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.PAPERSHARE_ALLOWED_ORIGINS);
const MIME_TYPE_BY_EXTENSION = Object.freeze({
  ".bmp": "image/bmp",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});
const EXTENSION_BY_MIME_TYPE = new Map(
  Object.entries(MIME_TYPE_BY_EXTENSION).map(([extension, mimeType]) => [
    normalizeMimeType(mimeType),
    extension,
  ])
);
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=300, must-revalidate";
const STATIC_HASHED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_HTML_CACHE_CONTROL = "no-cache";
const scryptAsync = promisify(crypto.scrypt);
const SQLITE_STORE = createSqliteStore({
  storageDir: STORAGE_DIR,
  jsonFilePaths: {
    [TABLES.PAPERS]: PAPERS_FILE,
    [TABLES.ANNOTATIONS]: ANNOTATIONS_FILE,
    [TABLES.DISCUSSIONS]: DISCUSSIONS_FILE,
    [TABLES.USERS]: USERS_FILE,
    [TABLES.SESSIONS]: SESSIONS_FILE,
  },
});
let appRouter = null;
let appServices = null;
const DEFAULT_USERS = [
  {
    id: "bootstrap-admin",
    username: "admin",
    role: "admin",
    passwordEnvVar: "PAPERSHARE_BOOTSTRAP_ADMIN_PASSWORD",
    createdAt: "2026-04-13T00:00:00.000Z",
  },
];

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start server.", error);
    process.exit(1);
  });
}

async function start() {
  await ensureStorageFiles();
  const server = createHttpServer();

  await new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      console.log(`PaperShare server running at http://${HOST}:${PORT}`);
      resolve();
    });
  });

  registerGracefulShutdown(server);
  return server;
}

function createHttpServer() {
  ensureAppRouter();

  return http.createServer(async (request, response) => {
    try {
      await routeRequest(request, response);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;

      if (statusCode >= 500) {
        console.error("Unhandled server error.", error);
      }

      sendJson(response, statusCode, {
        error: error.message || "Internal server error",
      });
    }
  });
}

function ensureAppRouter() {
  if (!appRouter) {
    appRouter = createRouter(ensureAppServices());
  }

  return appRouter;
}

function ensureAppServices() {
  if (!appServices) {
    appServices = createAppServices();
  }

  return appServices;
}

async function routeRequest(request, response) {
  if (!appRouter) {
    throw new Error("App router has not been initialized");
  }

  return appRouter(request, response);
}

async function getCurrentUserFromRequest(request) {
  const sessionToken = getSessionTokenFromRequest(request);

  if (!sessionToken) {
    return null;
  }

  const session = SQLITE_STORE.sessions.getByToken(sessionToken);

  if (!session) {
    return null;
  }

  return SQLITE_STORE.users.getById(session.userId) || null;
}

async function loginUser(body) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!username || !password) {
    throw new Error("用户名和密码不能为空");
  }

  let user = SQLITE_STORE.users.getByUsername(username);
  const passwordVerification = await verifyPassword(password, user?.passwordHash);

  if (!user || !passwordVerification.ok) {
    throw new Error("用户名或密码错误");
  }

  const token = createSessionToken();
  const createdAt = new Date().toISOString();

  if (passwordVerification.needsRehash) {
    user = {
      ...user,
      passwordHash: await hashPassword(password),
      updatedAt: createdAt,
    };
  }

  SQLITE_STORE.runInTransaction((repositories) => {
    if (passwordVerification.needsRehash) {
      repositories.users.update(user);
    }

    repositories.sessions.replaceSessionForUser({
      createdAt,
      token,
      userId: user.id,
    });
  });

  return {
    token,
    user: serializeAuthenticatedUser(user),
  };
}

async function deleteSession(sessionToken) {
  SQLITE_STORE.sessions.deleteByToken(sessionToken);
}

async function changeUserPassword(userId, body) {
  const currentPassword = String(body.currentPassword || "");
  const nextPassword = String(body.nextPassword || "");

  if (!currentPassword || !nextPassword) {
    throw new Error("当前密码和新密码不能为空");
  }

  if (nextPassword.length < 4) {
    throw new Error("新密码至少需要 4 位");
  }

  if (currentPassword === nextPassword) {
    throw new Error("新密码不能与当前密码相同");
  }

  const user = SQLITE_STORE.users.getById(userId);

  if (!user) {
    throw new Error("用户不存在");
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash)).ok) {
    throw new Error("当前密码错误");
  }

  SQLITE_STORE.users.update({
    ...user,
    mustChangePassword: false,
    passwordHash: await hashPassword(nextPassword),
    updatedAt: new Date().toISOString(),
  });
}

async function changeUsername(userId, body) {
  const nextUsername = normalizeUsername(body.username);
  const users = SQLITE_STORE.users.listAll();
  const userIndex = users.findIndex((item) => item.id === userId);

  if (userIndex === -1) {
    throw new HttpError(404, "用户不存在");
  }

  const currentUser = users[userIndex];
  validateUsername(nextUsername, users, currentUser.id);

  if (currentUser.username === nextUsername) {
    throw new Error("新用户名不能与当前用户名相同");
  }

  const updatedUser = {
    ...currentUser,
    username: nextUsername,
    updatedAt: new Date().toISOString(),
  };

  SQLITE_STORE.runInTransaction((repositories) => {
    repositories.users.update(updatedUser);
    syncUsernameAcrossRecords(repositories, currentUser, nextUsername);
  });

  return serializeUser(updatedUser);
}

async function createMemberUser(body) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const users = SQLITE_STORE.users.listAll();
  validateUsername(username, users);
  validatePasswordForCreation(password);

  const createdAt = new Date().toISOString();
  const user = {
    id: createUserId(username),
    username,
    role: "member",
    mustChangePassword: false,
    passwordHash: await hashPassword(password),
    createdAt,
    updatedAt: createdAt,
  };

  SQLITE_STORE.users.insert(user);
  return serializeUser(user);
}

function collectPaperIdsFromRecords(records) {
  return Array.from(
    new Set(
      (Array.isArray(records) ? records : [])
        .map((record) => String(record?.paperId || record?.id || "").trim())
        .filter(Boolean)
    )
  );
}

function refreshPaperActivitiesInRepositories(repositories, paperIds) {
  repositories.papers.refreshActivitiesByIds(paperIds);
}

function refreshAllPaperActivities() {
  SQLITE_STORE.runInTransaction((repositories) => {
    repositories.papers.backfillActivityFields();
  });
}

function syncUsernameAcrossRecords(repositories, currentUser, nextUsername) {
  const currentUserId = String(currentUser?.id || "").trim();
  const currentUsername = String(currentUser?.username || "").trim();
  const affectedPaperIds = new Set();

  repositories.papers.listByUser(currentUserId, currentUsername).forEach((paper) => {
    repositories.papers.update(
      normalizePaperRecord({
        ...paper,
        created_by_user_id: currentUserId || paper.created_by_user_id,
        created_by_username: nextUsername,
      })
    );
  });

  repositories.annotations.listByUser(currentUserId, currentUsername).forEach((annotation) => {
    if (annotation.paperId) {
      affectedPaperIds.add(annotation.paperId);
    }

    repositories.annotations.update(
      normalizeAnnotationRecord({
        ...annotation,
        created_by_user_id: currentUserId || annotation.created_by_user_id,
        created_by_username: nextUsername,
      })
    );
  });

  repositories.discussions.listByUser(currentUserId, currentUsername).forEach((discussion) => {
    if (discussion.paperId) {
      affectedPaperIds.add(discussion.paperId);
    }

    repositories.discussions.update(
      normalizeDiscussionRecord({
        ...discussion,
        created_by_user_id: currentUserId || discussion.created_by_user_id,
        created_by_username: nextUsername,
      })
    );
  });

  refreshPaperActivitiesInRepositories(repositories, Array.from(affectedPaperIds));
}

async function deleteUserById(currentUserId, userId, options = {}) {
  if (!userId) {
    throw new Error("缺少用户 ID");
  }

  if (userId === currentUserId) {
    throw new Error("不能删除当前登录的管理员账号");
  }

  const user = SQLITE_STORE.users.getById(userId);

  if (!user) {
    throw new HttpError(404, "用户不存在");
  }

  if (getUserRole(user) === "admin") {
    throw new Error("不能删除管理员账号");
  }

  const purgeContent = options.purgeContent === true;
  const deletedContent = purgeContent ? await deleteUserOwnedContent(userId) : null;

  SQLITE_STORE.runInTransaction((repositories) => {
    repositories.sessions.deleteByUserId(userId);
    repositories.users.deleteById(userId);
  });

  return {
    deletedUserId: userId,
    purgeContent,
    deletedContent,
  };
}

async function transferAdminRole(currentUserId, targetUserId) {
  if (!targetUserId) {
    throw new Error("缺少目标用户");
  }

  if (targetUserId === currentUserId) {
    throw new Error("不能转让给当前管理员自己");
  }

  const users = SQLITE_STORE.users.listAll();
  const currentUserIndex = users.findIndex((item) => item.id === currentUserId);
  const targetUserIndex = users.findIndex((item) => item.id === targetUserId);

  if (currentUserIndex === -1) {
    throw new HttpError(404, "当前管理员不存在");
  }

  if (targetUserIndex === -1) {
    throw new HttpError(404, "目标用户不存在");
  }

  const currentUser = users[currentUserIndex];
  const targetUser = users[targetUserIndex];

  if (getUserRole(targetUser) === "admin") {
    throw new Error("目标用户已经是管理员");
  }

  const updatedAt = new Date().toISOString();
  const nextCurrentUser = {
    ...currentUser,
    role: "member",
    updatedAt,
  };
  const nextTargetUser = {
    ...targetUser,
    role: "admin",
    updatedAt,
  };

  users[currentUserIndex] = nextCurrentUser;
  users[targetUserIndex] = nextTargetUser;
  SQLITE_STORE.runInTransaction((repositories) => {
    repositories.users.update(nextCurrentUser);
    repositories.users.update(nextTargetUser);
  });

  return {
    currentUser: serializeUser(nextCurrentUser),
    targetUser: serializeUser(nextTargetUser),
  };
}

async function deleteUserOwnedContent(userId) {
  const user = SQLITE_STORE.users.getById(userId);

  if (!user) {
    return {
      paperCount: 0,
      annotationCount: 0,
      discussionCount: 0,
    };
  }

  const deletedPapers = SQLITE_STORE.papers
    .listByUser(user.id, user.username)
    .map((paper) => normalizePaperRecord(paper));
  const deletedPaperIds = new Set(deletedPapers.map((paper) => paper.id));
  const deletedAnnotationsFromPapers = [];
  const deletedDiscussionsFromPapers = [];

  deletedPapers.forEach((paper) => {
    deletedAnnotationsFromPapers.push(
      ...SQLITE_STORE.annotations.listByPaperId(paper.id).map((annotation) =>
        normalizeAnnotationRecord(annotation)
      )
    );
    deletedDiscussionsFromPapers.push(
      ...SQLITE_STORE.discussions.listByPaperId(paper.id).map((discussion) =>
        normalizeDiscussionRecord(discussion)
      )
    );
  });

  const ownedAnnotations = SQLITE_STORE.annotations
    .listByUser(user.id, user.username)
    .map((annotation) => normalizeAnnotationRecord(annotation))
    .filter((annotation) => !deletedPaperIds.has(annotation.paperId));
  const ownedDiscussions = SQLITE_STORE.discussions
    .listByUser(user.id, user.username)
    .map((discussion) => normalizeDiscussionRecord(discussion))
    .filter((discussion) => !deletedPaperIds.has(discussion.paperId));
  const affectedPaperIds = collectPaperIdsFromRecords([...ownedAnnotations, ...ownedDiscussions]);
  let deletedAnnotations = [...deletedAnnotationsFromPapers];
  let deletedDiscussions = [...deletedDiscussionsFromPapers];

  SQLITE_STORE.runInTransaction((repositories) => {
    deletedPapers.forEach((paper) => {
      repositories.annotations.deleteByPaperId(paper.id);
      repositories.discussions.deleteByPaperId(paper.id);
    });

    repositories.papers.deleteByIds(Array.from(deletedPaperIds));
    deletedAnnotations = dedupeRecordsById([
      ...deletedAnnotations,
      ...deleteOwnedSpeechRecordsFromStore(repositories.annotations, ownedAnnotations, {
        getRootId: getThreadRootAnnotationId,
        isReply: isReplyAnnotation,
        normalizeRecord: normalizeAnnotationRecord,
        parentKey: "parent_annotation_id",
      }),
    ]);
    deletedDiscussions = dedupeRecordsById([
      ...deletedDiscussions,
      ...deleteOwnedSpeechRecordsFromStore(repositories.discussions, ownedDiscussions, {
        getRootId: getThreadRootDiscussionId,
        isReply: isDiscussionReply,
        normalizeRecord: normalizeDiscussionRecord,
        parentKey: "parent_discussion_id",
      }),
    ]);
    refreshPaperActivitiesInRepositories(repositories, affectedPaperIds);
  });

  const services = ensureAppServices();

  await Promise.all([
    Promise.all(deletedPapers.map((paper) => services.papers.deleteSnapshotByPath(paper.snapshotPath))),
    services.speech.deleteAttachmentsForRecords([...deletedAnnotations, ...deletedDiscussions]),
  ]);

  return {
    paperCount: deletedPapers.length,
    annotationCount: deletedAnnotations.length,
    discussionCount: deletedDiscussions.length,
  };
}

function deleteOwnedSpeechRecordsFromStore(repository, ownedRecords, options) {
  const deletedRecords = [];

  ownedRecords
    .filter((record) => !options.isReply(record))
    .forEach((record) => {
      const currentRecord = repository.getById(record.id);

      if (!currentRecord) {
        return;
      }

      const threadRecords = dedupeRecordsById([
        options.normalizeRecord(currentRecord),
        ...repository.listByRootId(record.id).map((item) => options.normalizeRecord(item)),
      ]);

      repository.deleteByIds(threadRecords.map((item) => item.id));
      deletedRecords.push(...threadRecords);
    });

  ownedRecords
    .filter((record) => options.isReply(record))
    .forEach((record) => {
      const currentRecord = repository.getById(record.id);

      if (!currentRecord) {
        return;
      }

      const normalizedRecord = options.normalizeRecord(currentRecord);
      const fallbackParentId =
        String(normalizedRecord[options.parentKey] || "").trim() || options.getRootId(normalizedRecord);

      repository.reparentChildren(record.id, fallbackParentId);
      repository.deleteById(record.id);
      deletedRecords.push(normalizedRecord);
    });

  return dedupeRecordsById(deletedRecords);
}

async function ensureStorageFiles() {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.mkdir(HTML_DIR, { recursive: true });
  await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });
  const storeState = await SQLITE_STORE.ensureReady();
  await ensureDefaultUsers();
  logOwnershipBackfillResult(SQLITE_STORE.backfillOwnership());

  if (storeState.addedSpeechCountColumn || storeState.migratedLegacyJson) {
    refreshAllPaperActivities();
  }
}

async function getJsonCollectionLength(filePath) {
  return SQLITE_STORE.getCollectionLength(filePath);
}

async function ensureDefaultUsers() {
  const users = SQLITE_STORE.users.listAll();
  const usersById = new Map(users.map((user) => [user.id, user]));
  const usersByUsername = new Map(users.map((user) => [user.username, user]));

  for (const defaultUser of DEFAULT_USERS) {
    const existingUser = usersById.get(defaultUser.id) || usersByUsername.get(defaultUser.username);

    if (!existingUser) {
      const { passwordEnvVar, ...defaultUserRecord } = defaultUser;
      const password = readRequiredBootstrapPassword(defaultUser);

      SQLITE_STORE.users.insert({
        ...defaultUserRecord,
        mustChangePassword: true,
        passwordHash: await hashPassword(password),
      });
      continue;
    }

    const nextRole = defaultUser.role || getUserRole(existingUser);
    const nextCreatedAt = existingUser.createdAt || defaultUser.createdAt;

    if (existingUser.role !== nextRole || existingUser.createdAt !== nextCreatedAt) {
      SQLITE_STORE.users.update({
        ...existingUser,
        role: nextRole,
        createdAt: nextCreatedAt,
      });
    }
  }
}

function logOwnershipBackfillResult(result) {
  const updatedSummaries = Object.entries(result || {}).filter(([, stats]) => Number(stats?.updatedCount || 0) > 0);

  if (updatedSummaries.length) {
    console.log(
      `Backfilled record ownership: ${updatedSummaries
        .map(([tableName, stats]) => `${tableName}=${Number(stats.updatedCount || 0)}`)
        .join(", ")}`
    );
  }

  Object.entries(result || {}).forEach(([tableName, stats]) => {
    if (!Number(stats?.unmatchedCount || 0)) {
      return;
    }

    const usernames = (Array.isArray(stats.unmatchedUsernames) ? stats.unmatchedUsernames : [])
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");

    console.warn(
      `Ownership backfill skipped ${Number(stats.unmatchedCount || 0)} ${tableName} record(s) with unknown usernames${usernames ? `: ${usernames}` : ""}`
    );
  });
}

async function serveStaticAsset(request, pathname, response) {
  const targetPath =
    pathname === "/"
      ? "/src/client/catalog/index.html"
      : pathname === "/paper.html"
        ? "/src/client/detail/paper.html"
        : pathname;
  const relativeTargetPath = decodeURIComponent(targetPath).replace(/^[/\\]+/, "");
  const normalizedPath = path.normalize(relativeTargetPath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(CLIENT_DIST_DIR, normalizedPath);

  if (!absolutePath.startsWith(CLIENT_DIST_DIR) || isForbiddenStaticPath(normalizedPath)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const stat = await fs.stat(absolutePath);

    if (!stat.isFile()) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    const fileExtension = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPE_BY_EXTENSION[fileExtension] || "application/octet-stream";
    const etag = createWeakEtagFromStat(stat);
    const lastModified = stat.mtime.toUTCString();
    const cacheControl = resolveStaticCacheControl(normalizedPath, fileExtension);

    if (isRequestFresh(request, etag, stat.mtime)) {
      response.writeHead(304, {
        "Cache-Control": cacheControl,
        ETag: etag,
        "Last-Modified": lastModified,
      });
      response.end();
      return;
    }

    response.writeHead(200, {
      "Cache-Control": cacheControl,
      "Content-Length": stat.size,
      "Content-Type": contentType,
      ETag: etag,
      "Last-Modified": lastModified,
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const content = await fs.readFile(absolutePath);
    response.end(content);
  } catch (error) {
    sendJson(response, 404, { error: "Not found" });
  }
}

async function readRequestJson(request) {
  const rawBody = (await readRequestBody(request)).toString("utf8");

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new Error("请求体不是合法 JSON");
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;

      if (size > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("请求体过大"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    request.on("error", reject);
  });
}

async function readSpeechMutationBody(request) {
  const contentType = String(request.headers["content-type"] || "");

  if (contentType.toLowerCase().includes("multipart/form-data")) {
    return readMultipartSpeechBody(request, contentType);
  }

  return readRequestJson(request);
}

async function readMultipartSpeechBody(request, contentType) {
  const { fields, files } = await streamMultipartFormData(request, contentType);
  const retainedAttachments = parseMultipartJsonField(fields.retainedAttachments, "保留附件格式不合法");

  return {
    ...fields,
    attachments: [
      ...normalizeRetainedAttachments(retainedAttachments),
      ...files.map(createMultipartAttachmentDraft),
    ],
  };
}

function streamMultipartFormData(request, contentType) {
  return new Promise((resolve, reject) => {
    let parser;

    try {
      parser = Busboy({
        headers: {
          ...request.headers,
          "content-type": contentType,
        },
        limits: {
          files: MAX_ATTACHMENT_COUNT,
          fileSize: MAX_ATTACHMENT_BYTES,
        },
      });
    } catch (error) {
      reject(new Error("multipart 请求缺少 boundary"));
      return;
    }

    const fields = {};
    const files = [];
    let totalBytes = 0;
    let settled = false;

    function cleanup() {
      request.off("data", handleChunk);
      request.off("error", handleRequestError);
      parser.removeAllListeners();
    }

    function fail(error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      request.unpipe(parser);
      request.resume();
      reject(error);
    }

    function handleChunk(chunk) {
      totalBytes += chunk.length;

      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        fail(new Error("请求体过大"));
        request.destroy();
      }
    }

    function handleRequestError(error) {
      fail(error);
    }

    parser.on("field", (name, value) => {
      if (name) {
        fields[name] = value;
      }
    });

    parser.on("file", (name, stream, info) => {
      const chunks = [];
      let fileSize = 0;
      const filename = String(info?.filename || "").trim();
      const mimeType = String(info?.mimeType || "").trim();

      stream.on("data", (chunk) => {
        fileSize += chunk.length;
        chunks.push(chunk);
      });

      stream.on("limit", () => {
        fail(new Error(`附件“${sanitizeAttachmentName(filename || "未命名附件")}”超过 ${formatLimitInMb(MAX_ATTACHMENT_BYTES)} MB 限制`));
      });

      stream.on("error", (error) => {
        fail(error);
      });

      stream.on("end", () => {
        if (settled || !filename) {
          return;
        }

        files.push({
          contentType: mimeType,
          data: Buffer.concat(chunks, fileSize),
          filename,
          name,
        });
      });
    });

    parser.on("filesLimit", () => {
      fail(new Error(`单次最多上传 ${MAX_ATTACHMENT_COUNT} 个附件`));
    });

    parser.on("error", (error) => {
      fail(error);
    });

    parser.on("finish", () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve({ fields, files });
    });

    request.on("data", handleChunk);
    request.on("error", handleRequestError);
    request.pipe(parser);
  });
}

function parseMultipartJsonField(rawValue, errorMessage) {
  const value = String(rawValue || "").trim();

  if (!value) {
    return [];
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(errorMessage);
  }
}

function normalizeRetainedAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    throw new Error("保留附件格式不合法");
  }

  return attachments.map((attachment) => normalizeAttachmentRecord(attachment));
}

function createMultipartAttachmentDraft(filePart) {
  return {
    name: sanitizeAttachmentName(filePart.filename || ""),
    mimeType: normalizeMimeType(filePart.contentType || ""),
    size: filePart.data.length,
    buffer: filePart.data,
  };
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function normalizePaperRecord(paper) {
  const keywords = normalizeKeywords(paper.keywords);
  const sourceUrl = String(paper.sourceUrl || "").trim();
  const explicitArticleImagesEnabled =
    typeof paper.articleImagesEnabled === "boolean"
      ? paper.articleImagesEnabled
      : typeof paper.article_images_enabled === "boolean"
        ? paper.article_images_enabled
        : null;

  return {
    id: paper.id,
    sourceUrl,
    title: cleanTextValue(paper.title),
    authors: cleanTextValue(paper.authors),
    journal: cleanTextValue(paper.journal),
    published: cleanTextValue(paper.published),
    abstract: cleanTextValue(paper.abstract),
    keywords,
    fetchedAt: paper.fetchedAt,
    updatedAt: paper.updatedAt,
    createdAt: paper.createdAt,
    created_by_user_id: String(paper.created_by_user_id || "").trim(),
    created_by_username: String(paper.created_by_username || "").trim(),
    snapshotPath: paper.snapshotPath || "",
    hasSnapshot: Boolean(paper.hasSnapshot),
    articleImagesEnabled:
      explicitArticleImagesEnabled ?? supportsArticleImagesForSourceUrl(sourceUrl),
    speechCount: Number(paper.speechCount) || 0,
    latestSpeechAt: String(paper.latestSpeechAt || "").trim(),
    latestSpeakerUsername: String(paper.latestSpeakerUsername || "").trim(),
  };
}

function normalizeAttachmentRecord(attachment) {
  const storagePath = String(attachment?.storage_path || attachment?.storagePath || "").trim();
  const normalizedStoragePath = normalizeStorageRecordPath(storagePath);
  const originalName = sanitizeAttachmentName(
    attachment?.original_name || attachment?.originalName || attachment?.filename || ""
  );
  const mimeType = normalizeMimeType(
    attachment?.mime_type || attachment?.mimeType || inferMimeTypeFromPath(normalizedStoragePath)
  );
  const extension =
    String(attachment?.extension || "").trim().toLowerCase() ||
    path.extname(normalizedStoragePath).toLowerCase() ||
    EXTENSION_BY_MIME_TYPE.get(mimeType) ||
    "";
  const category =
    String(attachment?.category || "").trim() || resolveAttachmentCategory(extension, mimeType);
  const safeStoragePath = normalizedStoragePath;

  return {
    id: String(attachment?.id || "").trim(),
    category,
    original_name: originalName,
    filename: String(attachment?.filename || path.posix.basename(safeStoragePath) || "").trim(),
    mime_type: mimeType,
    extension,
    size_bytes: Number(attachment?.size_bytes || attachment?.sizeBytes || 0) || 0,
    storage_path: safeStoragePath,
    url: safeStoragePath ? buildPrivateStorageUrl(safeStoragePath) : "",
    created_at: String(attachment?.created_at || attachment?.createdAt || "").trim(),
  };
}

function normalizeAnnotationRecord(annotation) {
  const normalizedAnnotation = {
    id: String(annotation.id || "").trim(),
    paperId: String(annotation.paperId || "").trim(),
    note: String(annotation.note || "").trim(),
    exact: String(annotation.exact || ""),
    prefix: String(annotation.prefix || ""),
    suffix: String(annotation.suffix || ""),
    target_scope: String(annotation.target_scope || "body").trim() || "body",
    start_offset: Number(annotation.start_offset) || 0,
    end_offset: Number(annotation.end_offset) || 0,
    created_by_user_id: String(annotation.created_by_user_id || "").trim(),
    created_by_username: String(annotation.created_by_username || "").trim(),
    created_at: String(annotation.created_at || annotation.createdAt || "").trim(),
    parent_annotation_id: String(annotation.parent_annotation_id || "").trim(),
    root_annotation_id: String(annotation.root_annotation_id || "").trim(),
    attachments: normalizeAttachmentRecords(annotation.attachments),
  };

  normalizedAnnotation.root_annotation_id =
    normalizedAnnotation.root_annotation_id ||
    normalizedAnnotation.parent_annotation_id ||
    normalizedAnnotation.id;

  return normalizedAnnotation;
}

function normalizeDiscussionRecord(discussion) {
  const normalizedDiscussion = {
    id: String(discussion.id || "").trim(),
    paperId: String(discussion.paperId || "").trim(),
    note: String(discussion.note || "").trim(),
    created_by_user_id: String(discussion.created_by_user_id || "").trim(),
    created_by_username: String(discussion.created_by_username || "").trim(),
    created_at: String(discussion.created_at || discussion.createdAt || "").trim(),
    parent_discussion_id: String(discussion.parent_discussion_id || "").trim(),
    root_discussion_id: String(discussion.root_discussion_id || "").trim(),
    attachments: normalizeAttachmentRecords(discussion.attachments),
  };

  normalizedDiscussion.root_discussion_id =
    normalizedDiscussion.root_discussion_id ||
    normalizedDiscussion.parent_discussion_id ||
    normalizedDiscussion.id;

  return normalizedDiscussion;
}

function dedupeRecordsById(records) {
  const seenIds = new Set();

  return records.filter((record) => {
    const recordId = String(record?.id || "").trim();

    if (!recordId || seenIds.has(recordId)) {
      return false;
    }

    seenIds.add(recordId);
    return true;
  });
}

function deleteOwnedAnnotationsFromCollection(annotations, userId) {
  const ownedThreadIds = new Set(
    annotations
      .filter(
        (annotation) =>
          !isReplyAnnotation(annotation) && String(annotation.created_by_user_id || "").trim() === userId
      )
      .map((annotation) => annotation.id)
  );
  let nextAnnotations = annotations.filter(
    (annotation) => !ownedThreadIds.has(getThreadRootAnnotationId(annotation))
  );
  const deletedRecords = annotations.filter((annotation) =>
    ownedThreadIds.has(getThreadRootAnnotationId(annotation))
  );
  const ownedReplyIds = nextAnnotations
    .filter(
      (annotation) =>
        isReplyAnnotation(annotation) && String(annotation.created_by_user_id || "").trim() === userId
    )
    .map((annotation) => annotation.id);

  ownedReplyIds.forEach((annotationId) => {
    const annotation = nextAnnotations.find((item) => item.id === annotationId);

    if (!annotation) {
      return;
    }

    const fallbackParentId =
      String(annotation.parent_annotation_id || "").trim() || getThreadRootAnnotationId(annotation);
    deletedRecords.push(annotation);
    nextAnnotations = nextAnnotations
      .filter((item) => item.id !== annotationId)
      .map((item) => {
        if (item.parent_annotation_id !== annotationId) {
          return item;
        }

        return normalizeAnnotationRecord({
          ...item,
          parent_annotation_id: fallbackParentId,
        });
      });
  });

  return {
    records: nextAnnotations,
    deletedRecords: dedupeRecordsById(deletedRecords),
  };
}

function deleteOwnedDiscussionsFromCollection(discussions, userId) {
  const ownedThreadIds = new Set(
    discussions
      .filter(
        (discussion) =>
          !isDiscussionReply(discussion) &&
          String(discussion.created_by_user_id || "").trim() === userId
      )
      .map((discussion) => discussion.id)
  );
  let nextDiscussions = discussions.filter(
    (discussion) => !ownedThreadIds.has(getThreadRootDiscussionId(discussion))
  );
  const deletedRecords = discussions.filter((discussion) =>
    ownedThreadIds.has(getThreadRootDiscussionId(discussion))
  );
  const ownedReplyIds = nextDiscussions
    .filter(
      (discussion) =>
        isDiscussionReply(discussion) &&
        String(discussion.created_by_user_id || "").trim() === userId
    )
    .map((discussion) => discussion.id);

  ownedReplyIds.forEach((discussionId) => {
    const discussion = nextDiscussions.find((item) => item.id === discussionId);

    if (!discussion) {
      return;
    }

    const fallbackParentId =
      String(discussion.parent_discussion_id || "").trim() ||
      getThreadRootDiscussionId(discussion);
    deletedRecords.push(discussion);
    nextDiscussions = nextDiscussions
      .filter((item) => item.id !== discussionId)
      .map((item) => {
        if (item.parent_discussion_id !== discussionId) {
          return item;
        }

        return normalizeDiscussionRecord({
          ...item,
          parent_discussion_id: fallbackParentId,
        });
      });
  });

  return {
    records: nextDiscussions,
    deletedRecords: dedupeRecordsById(deletedRecords),
  };
}

function normalizeKeywords(value) {
  return [...new Set(String(value || "").split(/[\n,，;；|]/).map(cleanTextValue))].filter(
    Boolean
  );
}

function normalizeAttachmentRecords(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map(normalizeAttachmentRecord)
    .filter((attachment) => attachment.storage_path && attachment.category);
}

function sanitizeAttachmentName(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  return path.basename(trimmed).replace(/[^\w.\-()\u4e00-\u9fa5 ]+/g, "_").slice(0, 120);
}

function enforceSnapshotArticleImagePolicy(rawHtml, sourceUrl) {
  const html = String(rawHtml || "");

  if (!html || supportsArticleImagesForSourceUrl(sourceUrl)) {
    return html;
  }

  return stripAllArticleImagesFromHtml(html);
}

function stripAllArticleImagesFromHtml(rawHtml) {
  let sanitizedHtml = String(rawHtml || "");

  const pairedTagNames = ["picture", "svg", "canvas", "video", "audio", "object", "embed"];

  pairedTagNames.forEach((tagName) => {
    sanitizedHtml = sanitizedHtml.replace(
      new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, "gi"),
      ""
    );
  });

  sanitizedHtml = sanitizedHtml
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<source\b[^>]*>/gi, "")
    .replace(/<image\b[^>]*\/?>/gi, "")
    .replace(
      /<meta\b[^>]*(?:property|name|itemprop)=["'](?:og:image|twitter:image|image|thumbnailurl)["'][^>]*>/gi,
      ""
    )
    .replace(/<link\b[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi, "")
    .replace(
      /\s(?:srcset|data-srcset|data-src|data-original|data-lazy-src|data-zoom-src|data-hires|poster)=(".*?"|'.*?'|[^\s>]+)/gi,
      ""
    )
    .replace(/\sstyle=(["'])([\s\S]*?)\1/gi, (match, quote, styleValue) => {
      const sanitizedStyle = stripBackgroundImagesFromInlineStyle(styleValue);
      return sanitizedStyle ? ` style=${quote}${sanitizedStyle}${quote}` : "";
    });

  return sanitizedHtml;
}

function resolveAttachmentDescriptor(originalName, mimeType) {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const extensionFromName = path.extname(originalName).toLowerCase();
  const extensionFromMime = EXTENSION_BY_MIME_TYPE.get(normalizedMimeType) || "";
  const extension = extensionFromName || extensionFromMime;
  const category = resolveAttachmentCategory(extension, normalizedMimeType);

  if (!category || !extension) {
    throw new Error("仅支持上传图片或表格文件（PNG/JPG/GIF/WEBP/BMP/CSV/TSV/XLS/XLSX/ODS）");
  }

  return {
    category,
    extension,
    mimeType: MIME_TYPE_BY_EXTENSION[extension] || normalizedMimeType || "application/octet-stream",
  };
}

function resolveAttachmentCategory(extension, mimeType) {
  const normalizedExtension = String(extension || "").trim().toLowerCase();
  const normalizedMimeType = normalizeMimeType(mimeType);

  if (
    IMAGE_ATTACHMENT_EXTENSIONS.has(normalizedExtension) ||
    normalizedMimeType.startsWith("image/")
  ) {
    return "image";
  }

  if (
    TABLE_ATTACHMENT_EXTENSIONS.has(normalizedExtension) ||
    [
      "text/csv",
      "text/tab-separated-values",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.spreadsheet",
    ].includes(normalizedMimeType)
  ) {
    return "table";
  }

  return "";
}

function inferMimeTypeFromPath(storagePath) {
  const extension = path.extname(String(storagePath || "")).toLowerCase();
  return MIME_TYPE_BY_EXTENSION[extension] || "application/octet-stream";
}

function formatLimitInMb(limitBytes) {
  return Math.round((limitBytes / (1024 * 1024)) * 10) / 10;
}

function splitPeople(value) {
  return String(value || "")
    .split(/[\n,，;；|]/)
    .map(cleanTextValue)
    .filter(Boolean);
}

function cleanTextValue(value) {
  return decodeHtmlEntities(String(value || "").replace(/\s+/g, " ").trim());
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function firstNonEmpty(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((cookies, segment) => {
      const separatorIndex = segment.indexOf("=");

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = segment.slice(0, separatorIndex).trim();
      const value = segment.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getSessionTokenFromRequest(request) {
  const authorizationHeader = String(request.headers.authorization || "").trim();

  if (/^Bearer\s+/i.test(authorizationHeader)) {
    return authorizationHeader.replace(/^Bearer\s+/i, "").trim();
  }

  const cookies = parseCookies(request.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || "";
}

function serializeSessionCookie(request, token) {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(isSecureRequest(request) ? ["Secure"] : []),
  ].join("; ");
}

function serializeExpiredSessionCookie(request) {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(isSecureRequest(request) ? ["Secure"] : []),
  ].join("; ");
}

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: getUserRole(user),
    createdAt: user.createdAt || "",
  };
}

function serializeAuthenticatedUser(user) {
  return {
    ...serializeUser(user),
    mustChangePassword: Boolean(user?.mustChangePassword),
  };
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function getUsernameLookupKey(username) {
  return normalizeUsername(username).toLowerCase();
}

function validateUsername(username, users, excludedUserId = "") {
  if (!username) {
    throw new Error("用户名不能为空");
  }

  if (username.length < 2) {
    throw new Error("用户名至少需要 2 个字符");
  }

  if (username.length > 32) {
    throw new Error("用户名不能超过 32 个字符");
  }

  if (/\s/.test(username)) {
    throw new Error("用户名不能包含空格");
  }

  const nextUsernameKey = getUsernameLookupKey(username);
  const duplicatedUser = users.find(
    (user) => user.id !== excludedUserId && getUsernameLookupKey(user.username) === nextUsernameKey
  );

  if (duplicatedUser) {
    throw new Error("该用户名已被占用");
  }
}

function validatePasswordForCreation(password) {
  if (!password) {
    throw new Error("初始密码不能为空");
  }

  if (password.length < 4) {
    throw new Error("初始密码至少需要 4 位");
  }
}

function readRequiredBootstrapPassword(defaultUser) {
  const passwordEnvVar = String(defaultUser?.passwordEnvVar || "").trim();
  const username = String(defaultUser?.username || "").trim() || defaultUser?.id || "bootstrap-user";

  if (!passwordEnvVar) {
    throw new Error(`Bootstrap 用户 ${username} 未配置 passwordEnvVar`);
  }

  if (!Object.prototype.hasOwnProperty.call(process.env, passwordEnvVar)) {
    throw new Error(
      `Bootstrap 用户 ${username} 缺少初始密码环境变量 ${passwordEnvVar}，请在首次启动前显式配置`
    );
  }

  const password = String(process.env[passwordEnvVar] ?? "");

  try {
    validatePasswordForCreation(password);
  } catch (error) {
    throw new Error(
      `Bootstrap 用户 ${username} 的初始密码环境变量 ${passwordEnvVar} 无效：${error.message}`
    );
  }

  return password;
}

function assertAdminUser(user) {
  if (!isAdminUser(user)) {
    throw new HttpError(403, "仅管理员可执行此操作");
  }
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = Buffer.from(await scryptAsync(String(password), salt, 64)).toString("hex");
  return `scrypt$${salt}$${derivedKey}`;
}

async function verifyPassword(password, passwordHash) {
  const normalizedHash = String(passwordHash || "").trim();

  if (!normalizedHash) {
    return { ok: false, needsRehash: false };
  }

  if (normalizedHash.startsWith("scrypt$")) {
    const parts = normalizedHash.split("$");

    if (parts.length !== 3 || !parts[1] || !parts[2]) {
      return { ok: false, needsRehash: false };
    }

    const derivedKey = Buffer.from(await scryptAsync(String(password), parts[1], 64));
    const expectedKey = Buffer.from(parts[2], "hex");
    const ok =
      derivedKey.length === expectedKey.length &&
      crypto.timingSafeEqual(derivedKey, expectedKey);

    return { ok, needsRehash: false };
  }

  const ok = createLegacyPasswordHash(password) === normalizedHash;
  return { ok, needsRehash: ok };
}

function createLegacyPasswordHash(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function createPaperId() {
  return `paper-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function createAnnotationId() {
  return `annotation-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function createDiscussionId() {
  return `discussion-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function createUserId(username) {
  const slug = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suffix = crypto.randomBytes(3).toString("hex");

  return slug ? `user-${slug}-${suffix}` : `user-${Date.now()}-${suffix}`;
}

function createAppServices() {
  return createServices({
    ANNOTATIONS_FILE,
    ATTACHMENTS_DIR,
    DISCUSSIONS_FILE,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_COUNT,
    MAX_TOTAL_ATTACHMENT_BYTES,
    PAPERS_FILE,
    PORT,
    STORAGE_DIR,
    HttpError,
    applyCorsHeaders,
    assertAdminUser,
    changeUserPassword,
    changeUsername,
    createAnnotationId,
    createAttachmentId,
    createDiscussionId,
    createMemberUser,
    createPaperId,
    deleteSession,
    deleteUserById,
    enforceSnapshotArticleImagePolicy,
    ensureStorageFiles,
    formatLimitInMb,
    fs,
    getCurrentUserFromRequest,
    getJsonCollectionLength,
    getSessionTokenFromRequest,
    loginUser,
    normalizeAnnotationRecord,
    normalizeAttachmentRecord,
    normalizeAttachmentRecords,
    normalizeDiscussionRecord,
    normalizePaperRecord,
    path,
    readRequestJson,
    readSpeechMutationBody,
    resolveAttachmentDescriptor,
    resolveStorageAbsolutePath,
    sendJson,
    serializeExpiredSessionCookie,
    serializeSessionCookie,
    serializeCurrentUser: serializeAuthenticatedUser,
    serializeUser,
    servePrivateStorageAsset,
    serveStaticAsset,
    store: SQLITE_STORE,
    transferAdminRole,
  });
}

module.exports = {
  createHttpServer,
  ensureStorageFiles,
  start,
  convertElsevierXmlToHtml,
  fetchElsevierArticleSnapshotHtml,
  resolveElsevierApiKey,
};

function createAttachmentId() {
  return `attachment-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function createSessionToken() {
  return `session-${Date.now()}-${crypto.randomBytes(16).toString("hex")}`;
}

function resolveStorageDirectory(configuredPath) {
  const normalizedPath = String(configuredPath || "").trim();

  if (!normalizedPath) {
    return path.join(ROOT_DIR, ".local", "storage");
  }

  return path.isAbsolute(normalizedPath)
    ? normalizedPath
    : path.resolve(ROOT_DIR, normalizedPath);
}

function loadEnvFile(filePath) {
  let rawEnv = "";

  try {
    rawEnv = fsSync.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  rawEnv.split(/\r?\n/).forEach((line) => {
    const parsedEntry = parseEnvLine(line);

    if (!parsedEntry || Object.prototype.hasOwnProperty.call(process.env, parsedEntry.key)) {
      return;
    }

    process.env[parsedEntry.key] = parsedEntry.value;
  });
}

function parseEnvLine(line) {
  const trimmedLine = String(line || "").trim();

  if (!trimmedLine || trimmedLine.startsWith("#")) {
    return null;
  }

  const normalizedLine = trimmedLine.startsWith("export ")
    ? trimmedLine.slice("export ".length).trim()
    : trimmedLine;
  const separatorIndex = normalizedLine.indexOf("=");

  if (separatorIndex <= 0) {
    return null;
  }

  const key = normalizedLine.slice(0, separatorIndex).trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  let value = normalizedLine.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const quote = value[0];
    value = value.slice(1, -1);

    if (quote === '"') {
      value = value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else {
      value = value.replace(/\\'/g, "'");
    }
  } else {
    const commentIndex = value.indexOf(" #");
    if (commentIndex >= 0) {
      value = value.slice(0, commentIndex).trimEnd();
    }
  }

  return { key, value };
}

function normalizeStorageRecordPath(storagePath) {
  const rawPath = String(storagePath || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/^storage\//, "");

  if (!rawPath) {
    return "";
  }

  const segments = rawPath.split("/").filter(Boolean);

  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
    throw new HttpError(400, "存储路径不合法");
  }

  return segments.join("/");
}

function resolveStorageAbsolutePath(storagePath) {
  return path.join(STORAGE_DIR, normalizeStorageRecordPath(storagePath));
}

function buildPrivateStorageUrl(storagePath) {
  return `/api/storage/${normalizeStorageRecordPath(storagePath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function isForbiddenStaticPath(normalizedPath) {
  const segments = String(normalizedPath || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
  const firstSegment = segments[0] || "";

  return [".git", ".local", "storage"].includes(firstSegment) || firstSegment.startsWith(".env");
}

async function servePrivateStorageAsset(storagePath, response) {
  const normalizedStoragePath = normalizeStorageRecordPath(storagePath);

  if (!normalizedStoragePath.startsWith("attachments/")) {
    throw new HttpError(404, "资源不存在");
  }

  const absolutePath = resolveStorageAbsolutePath(normalizedStoragePath);

  if (!absolutePath.startsWith(ATTACHMENTS_DIR)) {
    throw new HttpError(403, "Forbidden");
  }

  try {
    const stat = await fs.stat(absolutePath);

    if (!stat.isFile()) {
      throw new HttpError(404, "资源不存在");
    }

    const fileExtension = path.extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPE_BY_EXTENSION[fileExtension] || "application/octet-stream";
    const content = await fs.readFile(absolutePath);
    response.writeHead(200, { "Content-Type": contentType, "Content-Length": content.length });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new HttpError(404, "资源不存在");
    }
    throw error;
  }
}

function applyCorsHeaders(request, response) {
  const origin = String(request.headers.origin || "").trim();

  if (!origin) {
    return;
  }

  if (!isAllowedCorsOrigin(request, origin)) {
    return;
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("Vary", "Origin");
}

function resolveStaticCacheControl(normalizedPath, fileExtension) {
  if (fileExtension === ".html") {
    return STATIC_HTML_CACHE_CONTROL;
  }

  return /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(path.basename(normalizedPath))
    ? STATIC_HASHED_ASSET_CACHE_CONTROL
    : STATIC_ASSET_CACHE_CONTROL;
}

function parseAllowedOrigins(rawValue) {
  return new Set(
    String(rawValue || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function isSecureRequest(request) {
  const forwardedProto = String(request?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  return forwardedProto === "https" || Boolean(request?.socket?.encrypted);
}

function isAllowedCorsOrigin(request, origin) {
  if (!origin) {
    return false;
  }

  if (ALLOWED_ORIGINS.has(origin)) {
    return true;
  }

  const host = String(request?.headers?.host || "").trim();

  if (!host) {
    return false;
  }

  return origin === `${isSecureRequest(request) ? "https" : "http"}://${host}`;
}

function registerGracefulShutdown(server) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    try {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    } catch (error) {
      console.error(`Failed to close HTTP server during ${signal}.`, error);
    }

    try {
      await SQLITE_STORE.close();
    } catch (error) {
      console.error(`Failed to close SQLite store during ${signal}.`, error);
    }

    process.exit(0);
  }

  ["SIGINT", "SIGTERM"].forEach((signal) => {
    process.once(signal, () => {
      shutdown(signal).catch((error) => {
        console.error(`Failed to shut down after ${signal}.`, error);
        process.exit(1);
      });
    });
  });
}

function accumulateOwnedRecordCount(record, countsByUserId, countsByUsername) {
  const recordUserId = String(record?.created_by_user_id || "").trim();
  const recordUsername = String(record?.created_by_username || "").trim();

  if (recordUserId) {
    countsByUserId.set(recordUserId, (countsByUserId.get(recordUserId) || 0) + 1);
    return;
  }

  if (recordUsername) {
    countsByUsername.set(recordUsername, (countsByUsername.get(recordUsername) || 0) + 1);
  }
}

function getOwnedRecordCountForUser(user, countsByUserId, countsByUsername) {
  const userId = String(user?.id || "").trim();
  const username = String(user?.username || "").trim();

  return (countsByUserId.get(userId) || 0) + (countsByUsername.get(username) || 0);
}

function createWeakEtagFromStat(stat) {
  return `W/"${Number(stat.size || 0).toString(16)}-${Math.floor(stat.mtimeMs || 0).toString(16)}"`;
}

function isRequestFresh(request, etag, lastModifiedDate) {
  const ifNoneMatchHeader = String(request.headers["if-none-match"] || "").trim();

  if (ifNoneMatchHeader) {
    return ifNoneMatchHeader
      .split(",")
      .map((value) => value.trim())
      .includes(etag);
  }

  const ifModifiedSinceHeader = String(request.headers["if-modified-since"] || "").trim();

  if (!ifModifiedSinceHeader) {
    return false;
  }

  const ifModifiedSince = new Date(ifModifiedSinceHeader).getTime();

  if (!Number.isFinite(ifModifiedSince)) {
    return false;
  }

  return Math.floor(new Date(lastModifiedDate).getTime() / 1000) <= Math.floor(ifModifiedSince / 1000);
}
