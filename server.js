const http = require("http");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { XMLParser } = require("fast-xml-parser");
const {
  ARTICLE_IMAGE_SOURCE_RULES,
  canDeleteOwnedRecord,
  doesRecordBelongToUser,
  escapeHtml,
  extractAssignedJsonObject,
  getArticleImageSourceRule,
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  getUserRole,
  isAdminUser,
  isDiscussionReply,
  isReplyAnnotation,
  normalizeMimeType,
  parsePreloadedStateFromHtml,
  safeParseHostname,
  stripBackgroundImagesFromInlineStyle,
  supportsArticleImagesForSourceUrl,
  IMAGE_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
	MAX_TOTAL_ATTACHMENT_BYTES,
	TABLE_ATTACHMENT_EXTENSIONS,
} = require("./shared/papershare-shared");

loadEnvFile(path.join(__dirname, ".env"));

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
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
const ELSEVIER_API_BASE_URL = "https://api.elsevier.com/content/article";
const ELSEVIER_OBJECT_API_BASE_URL = "https://api.elsevier.com/content/object/eid";
const ELSEVIER_XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false,
  processEntities: true,
  parseTagValue: false,
});
const ELSEVIER_XML_ORDERED_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false,
  processEntities: true,
  parseTagValue: false,
  preserveOrder: true,
});
const MIME_TYPE_BY_EXTENSION = Object.freeze({
  ".bmp": "image/bmp",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".png": "image/png",
  ".tsv": "text/tab-separated-values; charset=utf-8",
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
const DEFAULT_USERS = [
  {
    id: "bootstrap-admin",
    username: "admin",
    role: "admin",
    passwordHash: hashPassword("1234"),
    createdAt: "2026-04-13T00:00:00.000Z",
  },
];
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".woff2": "font/woff2",
};

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start server.", error);
    process.exit(1);
  });
}

async function start() {
  await ensureStorageFiles();
  const server = http.createServer(async (request, response) => {
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

  server.listen(PORT, HOST, () => {
    console.log(`PaperShare server running at http://${HOST}:${PORT}`);
  });
}

async function routeRequest(request, response) {
  applyCorsHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host || `127.0.0.1:${PORT}`}`);
  const { pathname } = requestUrl;
  const currentUser = await getCurrentUserFromRequest(request);

  if (request.method === "POST" && pathname === "/api/auth/login") {
    try {
      const body = await readRequestJson(request);
      const session = await loginUser(body);

      sendJson(
        response,
        200,
        {
          ok: true,
          token: session.token,
          user: session.user,
        },
        {
          "Set-Cookie": serializeSessionCookie(session.token),
        }
      );
    } catch (error) {
      sendJson(response, 401, { error: error.message || "登录失败" });
    }
    return;
  }

  if (request.method === "GET" && pathname === "/api/auth/me") {
    sendJson(response, 200, {
      authenticated: Boolean(currentUser),
      user: currentUser ? serializeUser(currentUser) : null,
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    const sessionToken = getSessionTokenFromRequest(request);

    if (sessionToken) {
      await deleteSession(sessionToken);
    }

    sendJson(
      response,
      200,
      { ok: true },
      {
        "Set-Cookie": serializeExpiredSessionCookie(),
      }
    );
    return;
  }

  if (
    (request.method === "GET" || request.method === "HEAD") &&
    pathname === "/api/elsevier/object"
  ) {
    const eid = String(requestUrl.searchParams.get("eid") || "").trim();
    const mimeType = normalizeMimeType(requestUrl.searchParams.get("mimeType") || "");
    const { contentType, content } = await fetchElsevierObjectBinary(eid, mimeType);

    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": "private, max-age=86400",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.end(content);
    return;
  }

  if (pathname.startsWith("/api/") && !currentUser) {
    sendJson(response, 401, { error: "请先登录" });
    return;
  }

  const storageAssetMatch = pathname.match(/^\/api\/storage\/(.+)$/);

  if (request.method === "GET" && storageAssetMatch) {
    const storagePath = decodeURIComponent(storageAssetMatch[1]);
    await servePrivateStorageAsset(storagePath, response);
    return;
  }

  if (request.method === "GET" && pathname === "/api/me/annotations") {
    const annotations = await getAnnotationsByUserId(currentUser);
    sendJson(response, 200, annotations);
    return;
  }

  if (request.method === "GET" && pathname === "/api/me/dashboard") {
    const dashboard = await getUserDashboard(currentUser);
    sendJson(response, 200, dashboard);
    return;
  }

  if (request.method === "POST" && pathname === "/api/me/password") {
    try {
      const body = await readRequestJson(request);
      await changeUserPassword(currentUser.id, body);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, error.statusCode || 400, { error: error.message || "修改密码失败" });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/me/username") {
    try {
      const body = await readRequestJson(request);
      const user = await changeUsername(currentUser.id, body);
      sendJson(response, 200, { ok: true, user });
    } catch (error) {
      sendJson(response, error.statusCode || 400, { error: error.message || "修改用户名失败" });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/users") {
    try {
      assertAdminUser(currentUser);
      const body = await readRequestJson(request);
      const user = await createMemberUser(body);
      sendJson(response, 201, { ok: true, user });
    } catch (error) {
      sendJson(response, error.statusCode || 400, { error: error.message || "创建用户失败" });
    }
    return;
  }

  const transferAdminMatch = pathname.match(/^\/api\/users\/([^/]+)\/transfer-admin$/);

  if (request.method === "POST" && transferAdminMatch) {
    try {
      assertAdminUser(currentUser);
      const targetUserId = decodeURIComponent(transferAdminMatch[1]);
      const result = await transferAdminRole(currentUser.id, targetUserId);
      sendJson(response, 200, {
        ok: true,
        currentUser: result.currentUser,
        targetUser: result.targetUser,
      });
    } catch (error) {
      sendJson(response, error.statusCode || 400, { error: error.message || "转让管理员失败" });
    }
    return;
  }

  if (request.method === "GET" && pathname === "/api/users") {
    const users = await listUsersWithStats();
    sendJson(response, 200, users);
    return;
  }

  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);

  if (request.method === "DELETE" && userMatch) {
    try {
      assertAdminUser(currentUser);
      const userId = decodeURIComponent(userMatch[1]);
      const purgeContent = requestUrl.searchParams.get("purgeContent") === "1";
      const result = await deleteUserById(currentUser.id, userId, { purgeContent });
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, error.statusCode || 400, { error: error.message || "删除用户失败" });
    }
    return;
  }

  const userProfileMatch = pathname.match(/^\/api\/users\/([^/]+)\/profile$/);

  if (request.method === "GET" && userProfileMatch) {
    const userId = decodeURIComponent(userProfileMatch[1]);
    const profile = await getPublicUserProfile(userId);
    sendJson(response, 200, profile);
    return;
  }

  if (request.method === "GET" && pathname === "/api/status") {
    const papers = await readPapers();
    const annotations = await readJsonFile(ANNOTATIONS_FILE, []);
    const discussions = await readJsonFile(DISCUSSIONS_FILE, []);
    sendJson(response, 200, {
      ok: true,
      paperCount: papers.length,
      annotationCount: annotations.length,
      discussionCount: discussions.length,
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/papers") {
    const [papers, annotations, discussions] = await Promise.all([
      readPapers(),
      readAnnotations(),
      readDiscussions(),
    ]);
    const papersWithActivity = attachPaperSpeechStats(papers, annotations, discussions);
    sendJson(response, 200, papersWithActivity);
    return;
  }

  if (request.method === "POST" && pathname === "/api/papers") {
    const body = await readRequestJson(request);
    const sourceUrl = String(body.sourceUrl || "").trim();
    const elsevierApiKey = String(body.elsevierApiKey || "").trim();

    if (!sourceUrl) {
      sendJson(response, 400, { error: "缺少 sourceUrl" });
      return;
    }

    const paper = await fetchAndStorePaper(sourceUrl, currentUser, { elsevierApiKey });
    sendJson(response, 201, paper);
    return;
  }

  if (request.method === "POST" && pathname === "/api/papers/import-html") {
    const body = await readRequestJson(request);
    const sourceUrl = String(body.sourceUrl || "").trim();
    const rawHtml = String(body.rawHtml || "");
    const elsevierApiKey = String(body.elsevierApiKey || "").trim();

    if (!sourceUrl) {
      sendJson(response, 400, { error: "缺少 sourceUrl" });
      return;
    }

    if (!rawHtml.trim()) {
      sendJson(response, 400, { error: "缺少 rawHtml" });
      return;
    }

    const paper = await importPaperFromHtml(sourceUrl, rawHtml, currentUser, { elsevierApiKey });
    sendJson(response, 201, paper);
    return;
  }

  const paperContentMatch = pathname.match(/^\/api\/papers\/([^/]+)\/content$/);

  if (request.method === "GET" && paperContentMatch) {
    const paperId = decodeURIComponent(paperContentMatch[1]);
    const paper = await getPaperById(paperId);

    if (!paper) {
      sendJson(response, 404, { error: "文献不存在" });
      return;
    }

    if (!paper.snapshotPath) {
      sendJson(response, 404, { error: "当前文献没有网页快照" });
      return;
    }

    const snapshotPath = path.join(STORAGE_DIR, paper.snapshotPath);
    const rawHtml = await fs.readFile(snapshotPath, "utf8");
    sendJson(response, 200, {
      rawHtml: enforceSnapshotArticleImagePolicy(rawHtml, paper.sourceUrl),
    });
    return;
  }

  const paperAnnotationsMatch = pathname.match(/^\/api\/papers\/([^/]+)\/annotations$/);
  const paperDiscussionsMatch = pathname.match(/^\/api\/papers\/([^/]+)\/discussions$/);

  if (paperAnnotationsMatch) {
    const paperId = decodeURIComponent(paperAnnotationsMatch[1]);
    const paper = await getPaperById(paperId);

    if (!paper) {
      sendJson(response, 404, { error: "文献不存在" });
      return;
    }

    if (request.method === "GET") {
      const annotations = await getAnnotationsByPaperId(paperId);
      sendJson(response, 200, annotations);
      return;
    }

    if (request.method === "POST") {
      const body = await readSpeechMutationBody(request);
      const annotation = await saveAnnotation(paperId, body, currentUser);
      sendJson(response, 201, annotation);
      return;
    }

    if (request.method === "DELETE") {
      const deletedCount = await clearAnnotationsByPaperId(paperId, currentUser);
      sendJson(response, 200, { ok: true, deletedCount });
      return;
    }
  }

  if (paperDiscussionsMatch) {
    const paperId = decodeURIComponent(paperDiscussionsMatch[1]);
    const paper = await getPaperById(paperId);

    if (!paper) {
      sendJson(response, 404, { error: "文献不存在" });
      return;
    }

    if (request.method === "GET") {
      const discussions = await getDiscussionsByPaperId(paperId);
      sendJson(response, 200, discussions);
      return;
    }

    if (request.method === "POST") {
      const body = await readSpeechMutationBody(request);
      const discussion = await saveDiscussion(paperId, body, currentUser);
      sendJson(response, 201, discussion);
      return;
    }
  }

  const paperDetailMatch = pathname.match(/^\/api\/papers\/([^/]+)$/);

  if (paperDetailMatch) {
    const paperId = decodeURIComponent(paperDetailMatch[1]);

    if (request.method === "GET") {
      const paper = await getPaperById(paperId);

      if (!paper) {
        sendJson(response, 404, { error: "文献不存在" });
        return;
      }

      sendJson(response, 200, paper);
      return;
    }

    if (request.method === "DELETE") {
      const result = await deletePaperById(paperId, currentUser);
      sendJson(response, 200, result);
      return;
    }
  }

  const annotationDetailMatch = pathname.match(/^\/api\/annotations\/([^/]+)$/);

  const annotationReplyMatch = pathname.match(/^\/api\/annotations\/([^/]+)\/replies$/);
  const discussionDetailMatch = pathname.match(/^\/api\/discussions\/([^/]+)$/);
  const discussionReplyMatch = pathname.match(/^\/api\/discussions\/([^/]+)\/replies$/);

  if (request.method === "POST" && annotationReplyMatch) {
    try {
      const annotationId = decodeURIComponent(annotationReplyMatch[1]);
      const body = await readSpeechMutationBody(request);
      const reply = await saveAnnotationReply(annotationId, body, currentUser);
      sendJson(response, 201, reply);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      sendJson(response, statusCode, { error: error.message || "回复批注失败" });
    }
    return;
  }

  if (request.method === "PATCH" && annotationDetailMatch) {
    try {
      const annotationId = decodeURIComponent(annotationDetailMatch[1]);
      const body = await readSpeechMutationBody(request);
      const annotation = await updateAnnotationById(annotationId, body, currentUser);
      sendJson(response, 200, annotation);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      sendJson(response, statusCode, { error: error.message || "编辑批注失败" });
    }
    return;
  }

  if (request.method === "DELETE" && annotationDetailMatch) {
    const annotationId = decodeURIComponent(annotationDetailMatch[1]);
    const result = await deleteAnnotationById(annotationId, currentUser);
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && discussionReplyMatch) {
    try {
      const discussionId = decodeURIComponent(discussionReplyMatch[1]);
      const body = await readSpeechMutationBody(request);
      const reply = await saveDiscussionReply(discussionId, body, currentUser);
      sendJson(response, 201, reply);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      sendJson(response, statusCode, { error: error.message || "回复讨论失败" });
    }
    return;
  }

  if (request.method === "PATCH" && discussionDetailMatch) {
    try {
      const discussionId = decodeURIComponent(discussionDetailMatch[1]);
      const body = await readSpeechMutationBody(request);
      const discussion = await updateDiscussionById(discussionId, body, currentUser);
      sendJson(response, 200, discussion);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      sendJson(response, statusCode, { error: error.message || "编辑讨论失败" });
    }
    return;
  }

  if (request.method === "DELETE" && discussionDetailMatch) {
    const discussionId = decodeURIComponent(discussionDetailMatch[1]);
    const result = await deleteDiscussionById(discussionId, currentUser);
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "GET") {
    await serveStaticAsset(pathname, response);
    return;
  }

  sendJson(response, 404, { error: "未找到请求资源" });
}

async function fetchAndStorePaper(sourceUrl, currentUser, options = {}) {
  const validatedUrl = validateSourceUrl(sourceUrl);
  const normalizedUrl = validatedUrl.toString();
  const existingPaper = await getPaperBySourceUrl(normalizedUrl);
  const elsevierApiKey = resolveElsevierApiKey(options.elsevierApiKey);

  if (existingPaper) {
    throw new HttpError(409, buildDuplicatePaperMessage(existingPaper));
  }

  if (isElsevierSourceUrl(normalizedUrl) && elsevierApiKey) {
    try {
      const elsevierSnapshotHtml = await fetchElsevierArticleSnapshotHtml(
        normalizedUrl,
        elsevierApiKey
      );
      return storePaperSnapshot(normalizedUrl, elsevierSnapshotHtml, currentUser);
    } catch (error) {
      console.warn(`Elsevier API fallback failed for ${normalizedUrl}: ${error.message}`);
    }
  }

  const fetchResponse = await fetchHtmlDocument(normalizedUrl);

  if (!fetchResponse.ok) {
    if (fetchResponse.status === 403) {
      throw new Error(
        "抓取网页失败：目标站点可能启用了人机验证或访问限制。"
      );
    }

    throw new Error(`抓取网页失败：HTTP ${fetchResponse.status}`);
  }

  const contentType = fetchResponse.headers.get("content-type") || "";

  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new Error("目标网址返回的不是 HTML 页面");
  }

  const rawHtml = await fetchResponse.text();
  assertImportableHtml(rawHtml);
  return storePaperSnapshot(normalizedUrl, rawHtml, currentUser);
}

async function importPaperFromHtml(sourceUrl, rawHtml, currentUser, options = {}) {
  const validatedUrl = validateSourceUrl(sourceUrl);
  const normalizedUrl = validatedUrl.toString();
  const existingPaper = await getPaperBySourceUrl(normalizedUrl);
  const elsevierApiKey = resolveElsevierApiKey(options.elsevierApiKey);
  if (existingPaper) {
    throw new HttpError(409, buildDuplicatePaperMessage(existingPaper));
  }
  const normalizedHtml = String(rawHtml || "").trim();

  if (!normalizedHtml) {
    throw new Error("缺少 HTML 快照内容");
  }

  if (isElsevierSourceUrl(normalizedUrl) && !looksLikeElsevierFullTextXml(normalizedHtml) && elsevierApiKey) {
    try {
      const elsevierSnapshotHtml = await fetchElsevierArticleSnapshotHtml(
        normalizedUrl,
        elsevierApiKey,
        normalizedHtml
      );
      return storePaperSnapshot(normalizedUrl, elsevierSnapshotHtml, currentUser);
    } catch (error) {
      console.warn(`Elsevier API import fallback failed for ${normalizedUrl}: ${error.message}`);
    }
  }

  const importableHtml = await normalizeImportedArticleContent(normalizedUrl, normalizedHtml, options);
  return storePaperSnapshot(normalizedUrl, importableHtml, currentUser);
}

async function storePaperSnapshot(sourceUrl, rawHtml, currentUser) {
  const papers = await readPapers();
  const existingPaper = papers.find((paper) => paper.sourceUrl === sourceUrl);

  if (existingPaper) {
    throw new HttpError(409, buildDuplicatePaperMessage(existingPaper));
  }

  const paperId = createPaperId();
  const metadata = extractMetadataFromHtml(rawHtml, sourceUrl);
  const now = new Date().toISOString();
  const snapshotRelativePath = path.join("html", `${paperId}.html`).replaceAll("\\", "/");
  const snapshotAbsolutePath = path.join(STORAGE_DIR, snapshotRelativePath);
  const snapshotHtml = enforceSnapshotArticleImagePolicy(rawHtml, sourceUrl);

  await fs.writeFile(snapshotAbsolutePath, snapshotHtml, "utf8");

  const nextPaper = normalizePaperRecord({
    id: paperId,
    sourceUrl,
    title: metadata.title || sourceUrl,
    authors: metadata.authors,
    journal: metadata.journal,
    published: metadata.published,
    abstract: metadata.abstract,
    keywords: metadata.keywords,
    fetchedAt: now,
    updatedAt: now,
    createdAt: now,
    created_by_user_id: currentUser.id,
    created_by_username: currentUser.username,
    snapshotPath: snapshotRelativePath,
    hasSnapshot: true,
    articleImagesEnabled: supportsArticleImagesForSourceUrl(sourceUrl),
  });

  const nextPapers = [nextPaper, ...papers];

  await writeJsonFile(PAPERS_FILE, nextPapers);
  return nextPaper;
}

async function getPaperBySourceUrl(sourceUrl) {
  const papers = await readPapers();
  return papers.find((paper) => paper.sourceUrl === sourceUrl) || null;
}

function buildDuplicatePaperMessage(existingPaper) {
  const uploaderName = String(existingPaper?.created_by_username || "").trim();
  const uploaderLabel = uploaderName ? `用户${uploaderName}` : "其他用户";
  return `论文已由${uploaderLabel}上传，您可以用“检索文章”或在“组员动向”点击该用户找到已上传的该论文。`;
}

function validateSourceUrl(sourceUrl) {
  try {
    return new URL(sourceUrl);
  } catch (error) {
    throw new Error("请输入有效的网址");
  }
}

function resolveElsevierApiKey(value) {
  return String(value || process.env.ELSEVIER_API_KEY || "").trim();
}

function isElsevierSourceUrl(sourceUrl) {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    return hostname.includes("sciencedirect.com") || hostname.includes("elsevier.com");
  } catch (error) {
    return false;
  }
}

function looksLikeXmlDocument(rawContent) {
  const normalizedContent = String(rawContent || "").trim().toLowerCase();
  return normalizedContent.startsWith("<?xml") || normalizedContent.startsWith("<full-text-retrieval-response");
}

function looksLikeElsevierFullTextXml(rawContent) {
  const normalizedContent = String(rawContent || "").trim().toLowerCase();
  return (
    normalizedContent.includes("<full-text-retrieval-response") &&
    normalizedContent.includes("elsevier.com/xml")
  );
}

async function normalizeImportedArticleContent(sourceUrl, rawContent, options = {}) {
  if (looksLikeElsevierFullTextXml(rawContent)) {
    return convertElsevierXmlToHtml(rawContent, { sourceUrl });
  }

  if (looksLikeXmlDocument(rawContent)) {
    throw new Error("当前仅支持导入 HTML 页面源码，或 Elsevier Full Text API 返回的 XML。");
  }

  assertImportableHtml(rawContent);
  return rawContent;
}

function assertImportableHtml(rawHtml) {
  if (!looksLikeHtmlDocument(rawHtml)) {
    throw new Error("提供的内容不是有效的 HTML 页面源码");
  }

  if (isHumanVerificationHtml(rawHtml)) {
    throw new Error(
      "检测到这是一张人机验证或访问拦截页面，不是论文正文页面。请先在浏览器完成验证，再复制最终文章页面的源码。"
    );
  }
}

function looksLikeHtmlDocument(rawHtml) {
  const normalizedHtml = String(rawHtml || "").toLowerCase();

  return (
    normalizedHtml.includes("<html") ||
    normalizedHtml.includes("<head") ||
    normalizedHtml.includes("<body") ||
    normalizedHtml.includes("<meta")
  );
}

function looksLikeScholarlyArticleHtml(rawHtml) {
  const normalizedHtml = String(rawHtml || "").toLowerCase();
  const citationMarkers = [
    'name="citation_title"',
    'name="citation_author"',
    'name="citation_doi"',
    'name="citation_journal_title"',
  ];
  const fullTextMarkers = [
    'class="article__body',
    'class="article-section__content',
    'class="abstract-group',
    'name="citation_fulltext_html_url"',
    '"format-viewed":"full text"',
    '"access-denial":"no"',
    '<section class="article-section article-section__full"',
    ">plain language summary<",
    ">references<",
  ];
  const citationHitCount = citationMarkers.filter((marker) => normalizedHtml.includes(marker)).length;
  const fullTextHitCount = fullTextMarkers.filter((marker) => normalizedHtml.includes(marker)).length;

  return fullTextHitCount >= 1 || citationHitCount >= 3;
}

function isHumanVerificationHtml(rawHtml) {
  const normalizedHtml = String(rawHtml || "").toLowerCase();
  const challengeMarkers = [
    "captcha",
    "g-recaptcha",
    "hcaptcha",
    "cf-chl",
    "cf-browser-verification",
    "verify you are human",
    "human verification",
    "are you human",
    "security check",
    "attention required",
    "access denied",
    "please enable javascript and cookies",
  ];

  if (looksLikeScholarlyArticleHtml(normalizedHtml)) {
    return false;
  }

  return challengeMarkers.some((marker) => normalizedHtml.includes(marker));
}

async function fetchHtmlDocument(sourceUrl) {
  const baseOptions = {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  };

  try {
    return await fetch(sourceUrl, baseOptions);
  } catch (error) {
    if (!isTlsCertificateError(error)) {
      throw new Error(`抓取目标网页失败：${error.message}`);
    }

    const previousValue = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    try {
      return await fetch(sourceUrl, baseOptions);
    } finally {
      if (previousValue === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousValue;
      }
    }
  }
}

async function fetchElsevierArticleSnapshotHtml(sourceUrl, apiKey, sourceHtml = "") {
  const locator = extractElsevierArticleLocator(sourceUrl, sourceHtml);

  if (!locator) {
    throw new Error("无法从当前 Elsevier/ScienceDirect 链接中识别 DOI 或 PII。");
  }

  const xml = await fetchElsevierArticleXml(locator, apiKey);
  return convertElsevierXmlToHtml(xml, { sourceUrl });
}

function extractElsevierArticleLocator(sourceUrl, sourceHtml = "") {
  return (
    extractElsevierLocatorFromUrl(sourceUrl) ||
    extractElsevierLocatorFromHtml(sourceHtml) ||
    null
  );
}

function extractElsevierLocatorFromUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    const pathname = decodeURIComponent(url.pathname || "");
    const hostname = url.hostname.toLowerCase();

    if (hostname === "doi.org" || hostname === "dx.doi.org") {
      const doi = normalizeElsevierDoi(pathname.slice(1));
      return doi ? { type: "doi", value: doi } : null;
    }

    const doiMatch = pathname.match(/\/doi\/(10\.[^/?#]+)/i);
    if (doiMatch) {
      const doi = normalizeElsevierDoi(doiMatch[1]);
      return doi ? { type: "doi", value: doi } : null;
    }

    const piiMatch = pathname.match(/\/pii\/([^/?#]+)/i);
    if (piiMatch) {
      const pii = normalizeElsevierPii(piiMatch[1]);
      return pii ? { type: "pii", value: pii } : null;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function extractElsevierLocatorFromHtml(html) {
  const doi = normalizeElsevierDoi(
    firstNonEmpty([
      getMetaContent(html, "name", "citation_doi"),
      getMetaContent(html, "name", "dc.identifier"),
    ])
  );

  if (doi) {
    return { type: "doi", value: doi };
  }

  const candidateUrls = [
    getMetaContent(html, "property", "og:url"),
    getMetaContent(html, "name", "citation_fulltext_html_url"),
    getTagHref(html, "link", "rel", "canonical"),
  ].filter(Boolean);

  for (const candidateUrl of candidateUrls) {
    const locator = extractElsevierLocatorFromUrl(candidateUrl);
    if (locator) {
      return locator;
    }
  }

  return null;
}

function normalizeElsevierDoi(value) {
  return String(value || "")
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .trim();
}

function normalizeElsevierPii(value) {
  return String(value || "").replace(/[^0-9a-z]/gi, "").toUpperCase();
}

async function fetchElsevierArticleXml(locator, apiKey) {
  const requestUrl = `${ELSEVIER_API_BASE_URL}/${locator.type}/${encodeURIComponent(locator.value)}`;
  const response = await fetch(requestUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: {
      "X-ELS-APIKey": apiKey,
      accept: "text/xml",
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    },
  });
  const xml = await response.text();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Elsevier API 请求被拒绝，请检查 API key 是否有效且有全文权限。");
    }

    throw new Error(`Elsevier API 请求失败：HTTP ${response.status}`);
  }

  if (!looksLikeElsevierFullTextXml(xml)) {
    throw new Error("Elsevier API 返回的内容不是预期的全文 XML。");
  }

  return xml;
}

function convertElsevierXmlToHtml(xml, options = {}) {
  const parsedXml = ELSEVIER_XML_PARSER.parse(xml);
  const orderedXml = ELSEVIER_XML_ORDERED_PARSER.parse(xml);
  const root = parsedXml["full-text-retrieval-response"];

  if (!root?.coredata) {
    throw new Error("Elsevier XML 缺少 coredata，无法导入。");
  }

  const title = cleanTextValue(root.coredata["dc:title"]);
  const authors = arrayify(root.coredata["dc:creator"]).map(cleanTextValue).filter(Boolean);
  const journal = cleanTextValue(root.coredata["prism:publicationName"]);
  const doi = cleanTextValue(root.coredata["prism:doi"]);
  const published = cleanTextValue(
    firstNonEmpty([root.coredata["prism:coverDate"], root.coredata["prism:coverDisplayDate"]])
  );
  const abstract = cleanTextValue(root.coredata["dc:description"]);
  const keywords = arrayify(root.coredata["dcterms:subject"]).map(cleanTextValue).filter(Boolean);
  const objectMap = buildElsevierObjectMap(root);
  const articleNode =
    findFirstOrderedNode(orderedXml, "article") ||
    findFirstOrderedNode(orderedXml, "ja:article") ||
    findFirstOrderedNode(orderedXml, "ja:converted-article");

  if (!articleNode) {
    throw new Error("Elsevier XML 中未找到文章正文节点。");
  }

  const bodyNode = findFirstDirectOrderedChild(articleNode, "body");
  const tailNode = findFirstDirectOrderedChild(articleNode, "tail");
  const floatNode = findFirstDirectOrderedChild(articleNode, "ce:floats");
  const bodyHtml = renderElsevierOrderedNodes(bodyNode, {
    sectionDepth: 0,
    objectMap,
  });
  const bibliographyHtml = renderElsevierOrderedNodes(tailNode, {
    sectionDepth: 1,
    objectMap,
  });
  const figureHtml = renderElsevierOrderedNodes(floatNode, {
    sectionDepth: 1,
    objectMap,
  });
  const articleHtml = [bodyHtml, figureHtml, bibliographyHtml].filter(Boolean).join("");

  if (!articleHtml.trim()) {
    throw new Error("Elsevier XML 已获取，但未能转换出可读正文。");
  }

  const metaTags = [
    buildMetaTag("citation_title", title),
    ...authors.map((author) => buildMetaTag("citation_author", author)),
    buildMetaTag("citation_doi", doi),
    buildMetaTag("citation_journal_title", journal),
    buildMetaTag("citation_publication_date", published),
    buildMetaTag("citation_abstract", abstract),
    buildMetaTag("citation_publisher", "Elsevier"),
    buildMetaTag("description", abstract),
    buildMetaTag("keywords", keywords.join(", ")),
    buildMetaTag("papershare_source_format", "elsevier-api"),
  ]
    .filter(Boolean)
    .join("\n      ");

  const headerMeta = [
    authors.length ? `<p class="paper-share-inline-meta">${escapeHtml(authors.join(", "))}</p>` : "",
    [journal, published].filter(Boolean).length
      ? `<p class="paper-share-inline-meta">${escapeHtml([journal, published].filter(Boolean).join(" · "))}</p>`
      : "",
    abstract
      ? `<section class="paper-share-summary"><h2>Abstract</h2><p>${escapeHtml(abstract)}</p></section>`
      : "",
    keywords.length
      ? `<section class="paper-share-summary"><h2>Keywords</h2><p>${escapeHtml(
          keywords.join(" · ")
        )}</p></section>`
      : "",
  ]
    .filter(Boolean)
    .join("\n          ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title || options.sourceUrl || "Elsevier article")}</title>
      ${metaTags}
    <style>
      body { font-family: Georgia, "Times New Roman", serif; line-height: 1.7; color: #1f2937; margin: 0; background: #f6f5f1; }
      .paper-share-shell { max-width: 960px; margin: 0 auto; padding: 32px 24px 72px; }
      .paper-share-article { background: #fff; border-radius: 20px; padding: 32px; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08); }
      .paper-share-kicker { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #8b5e3c; margin: 0 0 12px; }
      .paper-share-title { font-size: 2rem; line-height: 1.25; margin: 0 0 16px; color: #111827; }
      .paper-share-inline-meta { margin: 8px 0; color: #4b5563; }
      .paper-share-summary { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
      .paper-share-summary h2, .paper-share-body section > h2, .paper-share-body section > h3, .paper-share-body section > h4 { color: #111827; }
      .paper-share-body { margin-top: 28px; }
      .paper-share-body section { margin-top: 24px; }
      .paper-share-body p { margin: 14px 0; }
      .paper-share-label { font-weight: 700; color: #8b5e3c; margin: 12px 0 4px; }
      .paper-share-heading-label { color: #8b5e3c; margin-right: 0.35em; }
      .paper-share-cross-ref { color: #5b6472; }
      .paper-share-math { font-family: "Times New Roman", serif; }
      .paper-share-math.paper-share-math-fallback { font-style: italic; }
      .paper-share-formula-block { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; margin: 18px 0; padding: 14px 18px; background: #faf7f2; border: 1px solid #eadfce; border-radius: 14px; }
      .paper-share-formula-block math { justify-self: center; max-width: 100%; }
      .paper-share-formula-label { color: #5b6472; white-space: nowrap; }
      .paper-share-figure, .paper-share-table, .paper-share-note { margin: 24px 0; padding: 16px 18px; background: #faf7f2; border: 1px solid #eadfce; border-radius: 14px; }
      .paper-share-figure-media { display: grid; gap: 12px; margin-bottom: 12px; }
      .paper-share-figure-media.paper-share-figure-media-multiple { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .paper-share-figure-link { display: block; color: inherit; }
      .paper-share-figure-image { display: block; width: 100%; height: auto; border-radius: 12px; background: #fff; }
      .paper-share-figure figcaption, .paper-share-table figcaption { margin-top: 8px; color: #374151; }
      .paper-share-reference-list { padding-left: 20px; }
    </style>
  </head>
  <body>
    <main class="paper-share-shell">
      <article class="paper-share-article">
        <header>
          <p class="paper-share-kicker">Imported From Elsevier Full Text API</p>
          <h1 class="paper-share-title">${escapeHtml(title || options.sourceUrl || "Elsevier article")}</h1>
          ${headerMeta}
        </header>
        <section class="paper-share-body">
          ${articleHtml}
        </section>
      </article>
    </main>
  </body>
</html>`;
}

function renderElsevierOrderedNodes(nodes, context = {}) {
  return arrayify(nodes)
    .map((node) => renderElsevierOrderedNode(node, context))
    .filter(Boolean)
    .join("");
}

function renderElsevierOrderedNode(node, context) {
  if (!node || typeof node !== "object") {
    return "";
  }

  if (typeof node["#text"] === "string") {
    return renderElsevierTextNode(node["#text"]);
  }

  const tagName = Object.keys(node).find((key) => key !== ":@");

  if (!tagName) {
    return "";
  }

  const children = node[tagName];
  const attributes = node[":@"] || {};

  switch (tagName) {
    case "body":
    case "head":
    case "tail":
    case "ce:sections":
    case "ce:abstract-sec":
      return renderElsevierOrderedNodes(children, context);
    case "ce:bibliography": {
      const titleHtml =
        renderElsevierOrderedNodes(findFirstDirectOrderedChild(children, "ce:section-title"), context) ||
        "<h2>References</h2>";
      const referenceNodes = [
        ...findAllDirectOrderedChildren(children, "sb:reference"),
        ...findAllDirectOrderedChildren(children, "ce:bib-reference"),
      ];

      if (!referenceNodes.length) {
        return `<section>${titleHtml}</section>`;
      }

      return `<section>${titleHtml}<ol class="paper-share-reference-list">${renderElsevierOrderedNodes(
        referenceNodes,
        context
      )}</ol></section>`;
    }
    case "ce:section":
    case "ce:appendix":
      return renderElsevierSection(children, context);
    case "ce:section-title": {
      const level = Math.min(6, Math.max(2, Number(context.sectionDepth || 0) + 1));
      return `<h${level}>${renderElsevierOrderedNodes(children, context)}</h${level}>`;
    }
    case "ce:label":
      return `<div class="paper-share-label">${renderElsevierOrderedNodes(children, context)}</div>`;
    case "ce:para":
    case "ce:simple-para":
      return `<p>${renderElsevierOrderedNodes(children, context)}</p>`;
    case "ce:list": {
      const listTag = String(attributes["@_list-type"] || "").toLowerCase().includes("order")
        ? "ol"
        : "ul";
      return `<${listTag}>${renderElsevierOrderedNodes(children, context)}</${listTag}>`;
    }
    case "ce:list-item":
    case "sb:reference":
    case "ce:bib-reference":
      return `<li>${renderElsevierOrderedNodes(children, context)}</li>`;
    case "ce:italic":
      return `<em>${renderElsevierOrderedNodes(children, context)}</em>`;
    case "ce:bold":
      return `<strong>${renderElsevierOrderedNodes(children, context)}</strong>`;
    case "ce:sup":
    case "mml:msup":
      return `<sup>${renderElsevierOrderedNodes(children, context)}</sup>`;
    case "ce:sub":
    case "ce:inf":
    case "mml:msub":
      return `<sub>${renderElsevierOrderedNodes(children, context)}</sub>`;
    case "ce:cross-ref":
    case "ce:cross-refs":
    case "ce:inter-ref":
      return `<span class="paper-share-cross-ref">${renderElsevierOrderedNodes(children, context)}</span>`;
    case "ce:inline-figure":
      return renderElsevierOrderedNodes(children, context);
    case "mml:math":
      return renderElsevierMathMarkup(node, {
        displayMode: false,
      });
    case "ce:inline-formula":
      return renderElsevierFormula(children, {
        displayMode: false,
      });
    case "ce:display":
      return renderElsevierFormula(children, {
        displayMode: true,
      });
    case "ce:figure":
      return renderElsevierFigure(children, context);
    case "ce:table":
      return `<figure class="paper-share-table">${renderElsevierOrderedNodes(children, context)}</figure>`;
    case "ce:caption":
      return `<figcaption>${renderElsevierOrderedNodes(children, context)}</figcaption>`;
    case "ce:note":
    case "ce:footnote":
      return `<aside class="paper-share-note">${renderElsevierOrderedNodes(children, context)}</aside>`;
    case "ce:link":
      return "";
    default:
      return renderElsevierOrderedNodes(children, context);
  }
}

function renderElsevierTextNode(value) {
  const normalizedValue = String(value || "").replace(/\s+/g, " ");
  return normalizedValue.trim() ? escapeHtml(normalizedValue) : "";
}

function buildElsevierObjectMap(root) {
  const objectMap = new Map();

  for (const objectNode of arrayify(root?.objects?.object)) {
    const ref = cleanTextValue(objectNode?.["@_ref"]);
    const mimeType = normalizeMimeType(objectNode?.["@_mimetype"]);
    const url = cleanTextValue(objectNode?.["#text"]);
    const eid = extractElsevierObjectEid(url);

    if (!ref || !mimeType.startsWith("image/") || !eid) {
      continue;
    }

    const categoryKey = cleanTextValue(objectNode?.["@_category"]).toLowerCase() || "default";
    const entry = {
      ref,
      eid,
      mimeType,
      width: parsePositiveInteger(objectNode?.["@_width"]),
      height: parsePositiveInteger(objectNode?.["@_height"]),
      size: parsePositiveInteger(objectNode?.["@_size"]),
    };
    const existingVariants = objectMap.get(ref) || {};
    const currentEntry = existingVariants[categoryKey];

    if (!currentEntry || shouldReplaceElsevierObjectEntry(currentEntry, entry)) {
      existingVariants[categoryKey] = entry;
      objectMap.set(ref, existingVariants);
    }
  }

  return objectMap;
}

function shouldReplaceElsevierObjectEntry(currentEntry, nextEntry) {
  const currentArea = Number(currentEntry?.width || 0) * Number(currentEntry?.height || 0);
  const nextArea = Number(nextEntry?.width || 0) * Number(nextEntry?.height || 0);

  if (nextArea !== currentArea) {
    return nextArea > currentArea;
  }

  return Number(nextEntry?.size || 0) > Number(currentEntry?.size || 0);
}

function parsePositiveInteger(value) {
  const parsedValue = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
}

function extractElsevierObjectEid(value) {
  const match = String(value || "").match(/\/content\/object\/eid\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function renderElsevierFigure(nodes, context = {}) {
  const labelNode = findFirstDirectOrderedNode(nodes, "ce:label");
  const labelText = cleanTextValue(
    labelNode ? collectElsevierOrderedText(labelNode["ce:label"]) : ""
  );
  const mediaHtml = renderElsevierFigureMedia(nodes, context, labelText);
  const contentNodes = arrayify(nodes).filter((node) => getOrderedNodeTagName(node) !== "ce:link");

  return `<figure class="paper-share-figure">${mediaHtml}${renderElsevierOrderedNodes(
    contentNodes,
    context
  )}</figure>`;
}

function renderElsevierFigureMedia(nodes, context = {}, labelText = "") {
  const figureObjects = [];
  const seenRefs = new Set();

  for (const linkNode of arrayify(nodes).filter((node) => getOrderedNodeTagName(node) === "ce:link")) {
    const attributes = linkNode?.[":@"] || {};
    const locator = cleanTextValue(
      firstNonEmpty([
        attributes["@_locator"],
        String(attributes["@_xlink:href"] || "")
          .split("/")
          .filter(Boolean)
          .pop(),
      ])
    );

    if (!locator || seenRefs.has(locator)) {
      continue;
    }

    seenRefs.add(locator);

    const variants = context.objectMap?.get(locator);

    if (!variants) {
      continue;
    }

    const previewObject =
      variants.standard || variants.high || variants.thumbnail || Object.values(variants)[0] || null;

    if (!previewObject) {
      continue;
    }

    figureObjects.push({
      locator,
      previewObject,
      fullObject: variants.high || previewObject,
    });
  }

  if (!figureObjects.length) {
    return "";
  }

  const mediaClassName = [
    "paper-share-figure-media",
    figureObjects.length > 1 ? "paper-share-figure-media-multiple" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<div class="${mediaClassName}">${figureObjects
    .map((figureObject, index) =>
      renderElsevierFigureImage(figureObject, {
        altText: buildElsevierFigureAltText(labelText, index, figureObjects.length),
      })
    )
    .join("")}</div>`;
}

function renderElsevierFigureImage(figureObject, options = {}) {
  const previewUrl = buildElsevierObjectProxyUrl(figureObject.previewObject);
  const fullUrl = buildElsevierObjectProxyUrl(figureObject.fullObject);
  const widthAttribute = figureObject.previewObject.width
    ? ` width="${figureObject.previewObject.width}"`
    : "";
  const heightAttribute = figureObject.previewObject.height
    ? ` height="${figureObject.previewObject.height}"`
    : "";

  return `<a class="paper-share-figure-link" href="${escapeHtml(
    fullUrl
  )}" target="_blank" rel="noreferrer"><img class="paper-share-figure-image" src="${escapeHtml(
    previewUrl
  )}" alt="${escapeHtml(options.altText || figureObject.locator)}" loading="lazy"${widthAttribute}${heightAttribute} /></a>`;
}

function buildElsevierFigureAltText(labelText, index, total) {
  const normalizedLabel = cleanTextValue(labelText);

  if (!normalizedLabel) {
    return total > 1 ? `Figure image ${index + 1}` : "Figure image";
  }

  return total > 1 ? `${normalizedLabel} (${index + 1})` : normalizedLabel;
}

function buildElsevierObjectProxyUrl(objectEntry) {
  const searchParams = new URLSearchParams({
    eid: objectEntry.eid,
    mimeType: objectEntry.mimeType,
  });
  return `/api/elsevier/object?${searchParams.toString()}`;
}

function collectElsevierOrderedText(nodes) {
  return arrayify(nodes)
    .map((node) => {
      if (!node || typeof node !== "object") {
        return "";
      }

      if (typeof node["#text"] === "string") {
        return node["#text"];
      }

      const tagName = Object.keys(node).find((key) => key !== ":@");
      return tagName ? collectElsevierOrderedText(node[tagName]) : "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderElsevierFormula(nodes, options = {}) {
  const labelNode =
    findFirstDirectOrderedNode(nodes, "ce:label") || findFirstOrderedNodeEntry(nodes, "ce:label");
  const labelText = cleanTextValue(
    labelNode ? collectElsevierOrderedText(labelNode["ce:label"]) : ""
  );
  const labelHtml = labelText
    ? `<span class="paper-share-formula-label">${escapeHtml(labelText)}</span>`
    : "";
  const mathNode =
    findFirstDirectOrderedNode(nodes, "mml:math") || findFirstOrderedNodeEntry(nodes, "mml:math");

  if (mathNode) {
    const mathHtml = renderElsevierMathMarkup(mathNode, {
      displayMode: Boolean(options.displayMode),
    });

    if (options.displayMode) {
      return `<div class="paper-share-formula-block">${mathHtml}${labelHtml}</div>`;
    }

    return `${mathHtml}${labelHtml}`;
  }

  const formulaText = collectElsevierOrderedText(
    arrayify(nodes).filter((node) => getOrderedNodeTagName(node) !== "ce:label")
  );

  if (!formulaText && !labelHtml) {
    return "";
  }

  const fallbackHtml = formulaText
    ? `<span class="paper-share-math paper-share-math-fallback">${escapeHtml(formulaText)}</span>`
    : "";

  if (options.displayMode) {
    return `<div class="paper-share-formula-block">${fallbackHtml}${labelHtml}</div>`;
  }

  return `${fallbackHtml}${labelHtml}`;
}

function renderElsevierSection(nodes, context = {}) {
  const sectionContext = {
    ...context,
    sectionDepth: Number(context.sectionDepth || 0) + 1,
  };
  const labelNode = findFirstDirectOrderedNode(nodes, "ce:label");
  const titleNode = findFirstDirectOrderedNode(nodes, "ce:section-title");
  const labelText = cleanTextValue(
    labelNode ? collectElsevierOrderedText(labelNode["ce:label"]) : ""
  );
  const titleHtml = titleNode
    ? renderElsevierOrderedNodes(titleNode["ce:section-title"], sectionContext)
    : "";
  const level = Math.min(6, Math.max(2, Number(sectionContext.sectionDepth || 0) + 1));
  const headingHtml =
    labelText || titleHtml
      ? `<h${level}>${
          labelText
            ? `<span class="paper-share-heading-label">${escapeHtml(labelText)}</span> `
            : ""
        }${titleHtml}</h${level}>`
      : "";
  const bodyNodes = headingHtml
    ? arrayify(nodes).filter((node) => {
        const tagName = getOrderedNodeTagName(node);
        return tagName !== "ce:label" && tagName !== "ce:section-title";
      })
    : nodes;

  return `<section>${headingHtml}${renderElsevierOrderedNodes(bodyNodes, sectionContext)}</section>`;
}

function renderElsevierMathMarkup(node, options = {}) {
  return renderElsevierMathNode(node, {
    displayMode: Boolean(options.displayMode),
    isRoot: true,
  });
}

function renderElsevierMathNodes(nodes, options = {}) {
  return arrayify(nodes)
    .map((node) => renderElsevierMathNode(node, options))
    .filter(Boolean)
    .join("");
}

function renderElsevierMathNode(node, options = {}) {
  if (!node || typeof node !== "object") {
    return "";
  }

  if (typeof node["#text"] === "string") {
    return renderElsevierMathTextNode(node["#text"]);
  }

  const tagName = getOrderedNodeTagName(node);

  if (!tagName) {
    return "";
  }

  const children = node[tagName];

  if (!tagName.startsWith("mml:")) {
    const fallbackText = collectElsevierOrderedText(children);
    return fallbackText ? `<mtext>${escapeHtml(fallbackText)}</mtext>` : "";
  }

  const localTagName = tagName.slice(4);

  if (localTagName === "annotation" || localTagName === "annotation-xml") {
    return "";
  }

  const attributes = renderElsevierMathAttributes(node[":@"], {
    ...options,
    localTagName,
  });
  const childrenHtml = renderElsevierMathNodes(children, {
    ...options,
    isRoot: false,
  });

  return `<${localTagName}${attributes}>${childrenHtml}</${localTagName}>`;
}

function renderElsevierMathAttributes(attributes, options = {}) {
  const renderedAttributes = [];
  const originalClassName = cleanTextValue(
    Object.entries(attributes || {}).find(([name]) => name === "@_class")?.[1]
  );

  if (options.isRoot) {
    renderedAttributes.push('xmlns="http://www.w3.org/1998/Math/MathML"');
    renderedAttributes.push(`display="${options.displayMode ? "block" : "inline"}"`);
    renderedAttributes.push(
      `class="${escapeHtml(
        [originalClassName, "paper-share-mathml", options.displayMode ? "paper-share-mathml-display" : ""]
          .filter(Boolean)
          .join(" ")
      )}"`
    );
  }

  for (const [rawAttributeName, rawAttributeValue] of Object.entries(attributes || {})) {
    const attributeName = String(rawAttributeName || "").replace(/^@_/, "");

    if (
      !attributeName ||
      attributeName === "class" ||
      attributeName === "display" ||
      attributeName.startsWith("xmlns")
    ) {
      continue;
    }

    const normalizedAttributeName = attributeName.includes(":")
      ? attributeName.split(":").pop()
      : attributeName;

    renderedAttributes.push(
      `${escapeHtml(normalizedAttributeName)}="${escapeHtml(String(rawAttributeValue ?? ""))}"`
    );
  }

  return renderedAttributes.length ? ` ${renderedAttributes.join(" ")}` : "";
}

function renderElsevierMathTextNode(value) {
  const normalizedValue = String(value || "").replace(/\s+/g, " ").trim();
  return normalizedValue ? escapeHtml(normalizedValue) : "";
}

function getOrderedNodeTagName(node) {
  if (!node || typeof node !== "object") {
    return "";
  }

  return Object.keys(node).find((key) => key !== ":@" && key !== "#text") || "";
}

function findFirstOrderedNode(nodes, targetTagName) {
  for (const node of arrayify(nodes)) {
    if (!node || typeof node !== "object") {
      continue;
    }

    if (node[targetTagName]) {
      return node[targetTagName];
    }

    const nestedValues = Object.entries(node)
      .filter(([key, value]) => key !== ":@" && Array.isArray(value))
      .map(([, value]) => value);

    for (const value of nestedValues) {
      const matched = findFirstOrderedNode(value, targetTagName);
      if (matched) {
        return matched;
      }
    }
  }

  return null;
}

function findFirstOrderedNodeEntry(nodes, targetTagName) {
  for (const node of arrayify(nodes)) {
    if (!node || typeof node !== "object") {
      continue;
    }

    if (node[targetTagName]) {
      return node;
    }

    const nestedValues = Object.entries(node)
      .filter(([key, value]) => key !== ":@" && key !== "#text" && Array.isArray(value))
      .map(([, value]) => value);

    for (const value of nestedValues) {
      const matched = findFirstOrderedNodeEntry(value, targetTagName);
      if (matched) {
        return matched;
      }
    }
  }

  return null;
}

function findFirstDirectOrderedNode(nodes, targetTagName) {
  for (const node of arrayify(nodes)) {
    if (node && typeof node === "object" && node[targetTagName]) {
      return node;
    }
  }

  return null;
}

function findFirstDirectOrderedChild(nodes, targetTagName) {
  for (const node of arrayify(nodes)) {
    if (node && typeof node === "object" && node[targetTagName]) {
      return node[targetTagName];
    }
  }

  return null;
}

function findAllDirectOrderedChildren(nodes, targetTagName) {
  return arrayify(nodes).filter(
    (node) => node && typeof node === "object" && node[targetTagName]
  );
}

function arrayify(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  return [value];
}

function buildMetaTag(name, content) {
  const normalizedContent = cleanTextValue(content);
  return normalizedContent
    ? `<meta name="${escapeHtml(name)}" content="${escapeHtml(normalizedContent)}" />`
    : "";
}

function extractMetadataFromHtml(html, sourceUrl) {
  const preloadedState = parsePreloadedStateFromHtml(html);
  const title =
    firstNonEmpty([
      getMetaContent(html, "property", "og:title"),
      getMetaContent(html, "name", "citation_title"),
      getMetaContent(html, "name", "twitter:title"),
      getTagContent(html, "title"),
    ]) || sourceUrl;

  const authors = [
    ...new Set(
      [
        ...getAllMetaContents(html, "name", "citation_author"),
        ...getAllMetaContents(html, "name", "dc.creator"),
        ...splitPeople(getMetaContent(html, "name", "author")),
        ...splitPeople(getMetaContent(html, "property", "article:author")),
        ...extractAuthorsFromPreloadedState(preloadedState),
      ].map(cleanTextValue).filter(Boolean)
    ),
  ].join(", ");

  const journal = firstNonEmpty([
    getMetaContent(html, "name", "citation_journal_title"),
    getMetaContent(html, "property", "og:site_name"),
  ]);

  const published = firstNonEmpty([
    getMetaContent(html, "name", "citation_publication_date"),
    getMetaContent(html, "property", "article:published_time"),
    getMetaContent(html, "name", "dc.date"),
  ]);

  const abstract = firstNonEmpty([
    getMetaContent(html, "name", "citation_abstract"),
    extractAbstractFromPreloadedState(preloadedState),
    extractAbstractFromHtml(html),
    getMetaContent(html, "name", "description"),
    getMetaContent(html, "property", "og:description"),
    getMetaContent(html, "name", "dc.description"),
  ]);

  const keywords = normalizeKeywords(
    firstNonEmpty([
      getMetaContent(html, "name", "keywords"),
      getMetaContent(html, "name", "news_keywords"),
      getMetaContent(html, "property", "article:tag"),
    ])
  );

  return {
    title: cleanTextValue(title),
    authors,
    journal: cleanTextValue(journal),
    published: cleanTextValue(published),
    abstract: cleanTextValue(abstract),
    keywords,
  };
}

function extractAbstractFromHtml(html) {
  const headingPattern = /<(h1|h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/gi;
  let headingMatch = headingPattern.exec(html);

  while (headingMatch) {
    const headingText = cleanTextValue(stripTags(headingMatch[2])).toLowerCase();
    if (
      headingText === "abstract" ||
      headingText === "summary" ||
      headingText === "摘要" ||
      headingText === "概要" ||
      headingText.includes("plain language summary")
    ) {
      const startIndex = headingMatch.index + headingMatch[0].length;
      const rest = html.slice(startIndex);
      const nextHeadingIndex = rest.search(/<h1|<h2|<h3|<h4/i);
      const sectionEndIndex = rest.search(/<\/section>/i);
      let endIndex = nextHeadingIndex;

      if (sectionEndIndex !== -1 && (endIndex === -1 || sectionEndIndex < endIndex)) {
        endIndex = sectionEndIndex;
      }

      const snippet = endIndex === -1 ? rest : rest.slice(0, endIndex);
      const extracted = extractParagraphText(snippet);
      if (extracted) {
        return extracted;
      }
    }

    headingMatch = headingPattern.exec(html);
  }

  const sectionPatterns = [
    /<section[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<section[^>]*id="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<section[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
    /<div[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of sectionPatterns) {
    const matched = html.match(pattern);
    const headingText = matched
      ? cleanTextValue(
          stripTags(
            (matched[1].match(/<(h1|h2|h3|h4)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || ""
          )
        ).toLowerCase()
      : "";

    if (headingText.includes("highlight")) {
      continue;
    }

    const extracted = matched ? extractParagraphText(matched[1]) : "";
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

function extractParagraphText(htmlSnippet) {
  const paragraphs = [];
  const paragraphPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match = paragraphPattern.exec(htmlSnippet);

  while (match) {
    const text = cleanTextValue(stripTags(match[1]));
    if (text) {
      paragraphs.push(text);
    }
    match = paragraphPattern.exec(htmlSnippet);
  }

  if (paragraphs.length) {
    return paragraphs.join(" ");
  }

  return cleanTextValue(stripTags(htmlSnippet));
}

function extractAuthorsFromPreloadedState(preloadedState) {
  const authors = [];
  const authorNodes = findStructuredNodesByName(preloadedState?.authors?.content, "author");

  for (const authorNode of authorNodes) {
    const givenName = firstNonEmpty(findStructuredNodeTextsByName(authorNode, "given-name"));
    const surname = firstNonEmpty(findStructuredNodeTextsByName(authorNode, "surname"));
    const fullName = cleanTextValue([givenName, surname].filter(Boolean).join(" "));

    if (fullName) {
      authors.push(fullName);
    }
  }

  return authors;
}

function extractAbstractFromPreloadedState(preloadedState) {
  const abstractSections = Array.isArray(preloadedState?.abstracts?.content)
    ? preloadedState.abstracts.content
    : [];

  for (const section of abstractSections) {
    const sectionTitle = firstNonEmpty(findStructuredNodeTextsByName(section, "section-title"))
      .toLowerCase()
      .trim();
    const sectionClass = cleanTextValue(section?.$?.class).toLowerCase();

    if (sectionTitle.includes("highlight") || sectionClass.includes("highlight")) {
      continue;
    }

    if (!sectionTitle || sectionTitle === "abstract" || sectionTitle === "summary") {
      const extracted = cleanTextValue(
        collectStructuredNodeText(section, {
          skippedNodeNames: new Set(["section-title", "label"]),
        })
      );

      if (extracted) {
        return extracted;
      }
    }
  }

  return "";
}

function findStructuredNodesByName(node, nodeName, results = []) {
  if (!node) {
    return results;
  }

  if (Array.isArray(node)) {
    node.forEach((child) => findStructuredNodesByName(child, nodeName, results));
    return results;
  }

  if (typeof node !== "object") {
    return results;
  }

  if (String(node["#name"] || "").toLowerCase() === String(nodeName || "").toLowerCase()) {
    results.push(node);
  }

  if (Array.isArray(node.$$)) {
    node.$$.forEach((child) => findStructuredNodesByName(child, nodeName, results));
  }

  return results;
}

function findStructuredNodeTextsByName(node, nodeName) {
  return findStructuredNodesByName(node, nodeName)
    .map((item) => cleanTextValue(item?._))
    .filter(Boolean);
}

function collectStructuredNodeText(node, options = {}) {
  const skippedNodeNames = options.skippedNodeNames || new Set();

  if (!node) {
    return "";
  }

  if (Array.isArray(node)) {
    return node.map((child) => collectStructuredNodeText(child, options)).join(" ");
  }

  if (typeof node !== "object") {
    return typeof node === "string" ? node : "";
  }

  const nodeName = String(node["#name"] || "").toLowerCase();

  if (skippedNodeNames.has(nodeName)) {
    return "";
  }

  const parts = [];

  if (typeof node._ === "string") {
    parts.push(node._);
  }

  if (Array.isArray(node.$$)) {
    parts.push(...node.$$.map((child) => collectStructuredNodeText(child, options)));
  }

  return parts.join(" ");
}

function getMetaContent(html, attributeName, attributeValue) {
  const normalizedAttributeName = String(attributeName || "").toLowerCase();
  const normalizedAttributeValue = String(attributeValue || "").toLowerCase();

  for (const attributes of findTagAttributes(html, "meta")) {
    if (String(attributes[normalizedAttributeName] || "").toLowerCase() !== normalizedAttributeValue) {
      continue;
    }

    return decodeHtmlEntities(attributes.content || "");
  }

  return "";
}

function getAllMetaContents(html, attributeName, attributeValue) {
  const values = [];
  const normalizedAttributeName = String(attributeName || "").toLowerCase();
  const normalizedAttributeValue = String(attributeValue || "").toLowerCase();

  for (const attributes of findTagAttributes(html, "meta")) {
    if (String(attributes[normalizedAttributeName] || "").toLowerCase() !== normalizedAttributeValue) {
      continue;
    }

    const content = decodeHtmlEntities(attributes.content || "");
    if (content) {
      values.push(content);
    }
  }

  return values;
}

function getTagContent(html, tagName) {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const matched = html.match(pattern);
  return matched ? decodeHtmlEntities(stripTags(matched[1])) : "";
}

function getTagHref(html, tagName, attributeName, attributeValue) {
  const normalizedAttributeName = String(attributeName || "").toLowerCase();
  const normalizedAttributeValue = String(attributeValue || "").toLowerCase();

  for (const attributes of findTagAttributes(html, tagName)) {
    if (String(attributes[normalizedAttributeName] || "").toLowerCase() !== normalizedAttributeValue) {
      continue;
    }

    return decodeHtmlEntities(attributes.href || "");
  }

  return "";
}

function findTagAttributes(html, tagName) {
  const source = getHeadHtmlSnippet(html);
  const normalizedTagName = escapeRegExp(String(tagName || "").trim());

  if (!normalizedTagName) {
    return [];
  }

  const tagPattern = new RegExp(`<${normalizedTagName}\\b[^>]*>`, "gi");
  const matches = [];
  let tagMatch = tagPattern.exec(source);

  while (tagMatch) {
    matches.push(parseTagAttributes(tagMatch[0]));
    tagMatch = tagPattern.exec(source);
  }

  return matches;
}

function getHeadHtmlSnippet(html) {
  const source = String(html || "");
  const headMatch = source.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);

  if (headMatch) {
    return headMatch[1];
  }

  return source.slice(0, 262144);
}

function parseTagAttributes(tagMarkup) {
  const source = String(tagMarkup || "");
  const attributes = {};
  const attributePattern =
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let attributeMatch = attributePattern.exec(source);

  while (attributeMatch) {
    const attributeName = String(attributeMatch[1] || "").toLowerCase();
    const attributeValue = firstNonEmpty([
      attributeMatch[2],
      attributeMatch[3],
      attributeMatch[4],
    ]);

    if (attributeName && !(attributeName in attributes)) {
      attributes[attributeName] = attributeValue;
    }

    attributeMatch = attributePattern.exec(source);
  }

  return attributes;
}

async function getCurrentUserFromRequest(request) {
  const sessionToken = getSessionTokenFromRequest(request);

  if (!sessionToken) {
    return null;
  }

  const sessions = await readJsonFile(SESSIONS_FILE, []);
  const session = sessions.find((item) => item.token === sessionToken);

  if (!session) {
    return null;
  }

  const users = await readJsonFile(USERS_FILE, []);
  return users.find((item) => item.id === session.userId) || null;
}

async function loginUser(body) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!username || !password) {
    throw new Error("用户名和密码不能为空");
  }

  const users = await readJsonFile(USERS_FILE, []);
  const user = users.find((item) => item.username === username);

  if (!user || user.passwordHash !== hashPassword(password)) {
    throw new Error("用户名或密码错误");
  }

  const sessions = await readJsonFile(SESSIONS_FILE, []);
  const nextSessions = sessions.filter((item) => item.userId !== user.id);
  const token = createSessionToken();

  nextSessions.push({
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
  });

  await writeJsonFile(SESSIONS_FILE, nextSessions);

  return {
    token,
    user: serializeUser(user),
  };
}

async function deleteSession(sessionToken) {
  const sessions = await readJsonFile(SESSIONS_FILE, []);
  const nextSessions = sessions.filter((item) => item.token !== sessionToken);
  await writeJsonFile(SESSIONS_FILE, nextSessions);
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

  const users = await readJsonFile(USERS_FILE, []);
  const userIndex = users.findIndex((item) => item.id === userId);

  if (userIndex === -1) {
    throw new Error("用户不存在");
  }

  const user = users[userIndex];

  if (user.passwordHash !== hashPassword(currentPassword)) {
    throw new Error("当前密码错误");
  }

  users[userIndex] = {
    ...user,
    passwordHash: hashPassword(nextPassword),
    updatedAt: new Date().toISOString(),
  };

  await writeJsonFile(USERS_FILE, users);
}

async function changeUsername(userId, body) {
  const nextUsername = normalizeUsername(body.username);
  const users = await readJsonFile(USERS_FILE, []);
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

  users[userIndex] = updatedUser;
  await writeJsonFile(USERS_FILE, users);
  await syncUsernameAcrossRecords(currentUser.id, nextUsername);
  return serializeUser(updatedUser);
}

async function createMemberUser(body) {
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const users = await readJsonFile(USERS_FILE, []);
  validateUsername(username, users);
  validatePasswordForCreation(password);

  const createdAt = new Date().toISOString();
  const user = {
    id: createUserId(username),
    username,
    role: "member",
    passwordHash: hashPassword(password),
    createdAt,
    updatedAt: createdAt,
  };

  users.push(user);
  await writeJsonFile(USERS_FILE, users);
  return serializeUser(user);
}

async function syncUsernameAcrossRecords(userId, username) {
  const [papers, annotations, discussions] = await Promise.all([
    readPapers(),
    readAnnotations(),
    readDiscussions(),
  ]);

  let papersChanged = false;
  let annotationsChanged = false;
  let discussionsChanged = false;

  const nextPapers = papers.map((paper) => {
    if (paper.created_by_user_id !== userId || paper.created_by_username === username) {
      return paper;
    }

    papersChanged = true;
    return {
      ...paper,
      created_by_username: username,
    };
  });

  const nextAnnotations = annotations.map((annotation) => {
    if (annotation.created_by_user_id !== userId || annotation.created_by_username === username) {
      return annotation;
    }

    annotationsChanged = true;
    return {
      ...annotation,
      created_by_username: username,
    };
  });

  const nextDiscussions = discussions.map((discussion) => {
    if (discussion.created_by_user_id !== userId || discussion.created_by_username === username) {
      return discussion;
    }

    discussionsChanged = true;
    return {
      ...discussion,
      created_by_username: username,
    };
  });

  await Promise.all([
    papersChanged ? writeJsonFile(PAPERS_FILE, nextPapers) : Promise.resolve(),
    annotationsChanged ? writeAnnotations(nextAnnotations) : Promise.resolve(),
    discussionsChanged ? writeDiscussions(nextDiscussions) : Promise.resolve(),
  ]);
}

async function deleteUserById(currentUserId, userId, options = {}) {
  if (!userId) {
    throw new Error("缺少用户 ID");
  }

  if (userId === currentUserId) {
    throw new Error("不能删除当前登录的管理员账号");
  }

  const users = await readJsonFile(USERS_FILE, []);
  const user = users.find((item) => item.id === userId);

  if (!user) {
    throw new HttpError(404, "用户不存在");
  }

  if (getUserRole(user) === "admin") {
    throw new Error("不能删除管理员账号");
  }

  const nextUsers = users.filter((item) => item.id !== userId);
  const sessions = await readJsonFile(SESSIONS_FILE, []);
  const nextSessions = sessions.filter((session) => session.userId !== userId);

  const purgeContent = options.purgeContent === true;
  const deletedContent = purgeContent ? await deleteUserOwnedContent(userId) : null;

  await Promise.all([
    writeJsonFile(USERS_FILE, nextUsers),
    writeJsonFile(SESSIONS_FILE, nextSessions),
  ]);

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

  const users = await readJsonFile(USERS_FILE, []);
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
  await writeJsonFile(USERS_FILE, users);

  return {
    currentUser: serializeUser(nextCurrentUser),
    targetUser: serializeUser(nextTargetUser),
  };
}

async function deleteUserOwnedContent(userId) {
  const [papers, annotations, discussions] = await Promise.all([
    readPapers(),
    readAnnotations(),
    readDiscussions(),
  ]);
  const deletedPaperIds = new Set(
    papers
      .filter((paper) => paper.created_by_user_id === userId)
      .map((paper) => paper.id)
  );
  const deletedPapers = papers.filter((paper) => deletedPaperIds.has(paper.id));
  const nextPapers = papers.filter((paper) => !deletedPaperIds.has(paper.id));
  const annotationsAfterPaperDeletion = annotations.filter(
    (annotation) => !deletedPaperIds.has(annotation.paperId)
  );
  const discussionsAfterPaperDeletion = discussions.filter(
    (discussion) => !deletedPaperIds.has(discussion.paperId)
  );
  const deletedAnnotationsFromPapers = annotations.filter((annotation) =>
    deletedPaperIds.has(annotation.paperId)
  );
  const deletedDiscussionsFromPapers = discussions.filter((discussion) =>
    deletedPaperIds.has(discussion.paperId)
  );
  const annotationDeletionResult = deleteOwnedAnnotationsFromCollection(
    annotationsAfterPaperDeletion,
    userId
  );
  const discussionDeletionResult = deleteOwnedDiscussionsFromCollection(
    discussionsAfterPaperDeletion,
    userId
  );
  const deletedAnnotations = dedupeRecordsById([
    ...deletedAnnotationsFromPapers,
    ...annotationDeletionResult.deletedRecords,
  ]);
  const deletedDiscussions = dedupeRecordsById([
    ...deletedDiscussionsFromPapers,
    ...discussionDeletionResult.deletedRecords,
  ]);

  await Promise.all([
    writeJsonFile(PAPERS_FILE, nextPapers),
    writeAnnotations(annotationDeletionResult.records),
    writeDiscussions(discussionDeletionResult.records),
    Promise.all(deletedPapers.map((paper) => removePaperSnapshot(paper.snapshotPath))),
    deleteAttachmentsForRecords([...deletedAnnotations, ...deletedDiscussions]),
  ]);

  return {
    paperCount: deletedPapers.length,
    annotationCount: deletedAnnotations.length,
    discussionCount: deletedDiscussions.length,
  };
}

async function getPaperById(paperId) {
  const papers = await readPapers();
  return papers.find((paper) => paper.id === paperId) || null;
}

async function getAnnotationById(annotationId) {
  const annotations = await readAnnotations();
  return annotations.find((annotation) => annotation.id === annotationId) || null;
}

async function getDiscussionById(discussionId) {
  const discussions = await readDiscussions();
  return discussions.find((discussion) => discussion.id === discussionId) || null;
}

async function getAnnotationsByPaperId(paperId) {
  const annotations = await readAnnotations();
  return annotations
    .filter((annotation) => annotation.paperId === paperId)
    .sort(compareAnnotationsByCreatedAt);
}

async function getDiscussionsByPaperId(paperId) {
  const discussions = await readDiscussions();
  return discussions
    .filter((discussion) => discussion.paperId === paperId)
    .sort(compareDiscussionsByCreatedAt);
}

async function getAnnotationsByUserId(currentUser) {
  const dashboard = await getUserDashboard(currentUser);
  return dashboard.myAnnotations;
}

async function listUsersWithStats() {
  const [users, papers, annotations, discussions] = await Promise.all([
    readJsonFile(USERS_FILE, []),
    readPapers(),
    readAnnotations(),
    readDiscussions(),
  ]);

  return users
    .map((user) => ({
      ...serializeUser(user),
      uploadedPaperCount: papers.filter((paper) => doesRecordBelongToUser(paper, user)).length,
      annotationCount:
        annotations.filter((annotation) => doesRecordBelongToUser(annotation, user)).length +
        discussions.filter((discussion) => doesRecordBelongToUser(discussion, user)).length,
    }))
    .sort(compareUsersForDisplay);
}

async function getUserDashboard(currentUser) {
  const [annotations, discussions, papers] = await Promise.all([
    readAnnotations(),
    readDiscussions(),
    readPapers(),
  ]);
  const papersById = new Map(papers.map((paper) => [paper.id, paper]));
  const annotationsById = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const discussionsById = new Map(discussions.map((discussion) => [discussion.id, discussion]));
  const uploadedPapers = papers
    .filter((paper) => doesRecordBelongToUser(paper, currentUser))
    .map((paper) => ({
      ...paper,
      activity_at: paper.updatedAt || paper.createdAt || paper.fetchedAt || "",
    }))
    .sort(compareRecordsByActivityDesc("activity_at"));
  const annotationSpeeches = annotations
    .filter((annotation) => doesRecordBelongToUser(annotation, currentUser))
    .map((annotation) => serializeAnnotationActivity(annotation, papersById, annotationsById))
    .sort(compareRecordsByActivityDesc("activity_at"));
  const discussionSpeeches = discussions
    .filter((discussion) => doesRecordBelongToUser(discussion, currentUser))
    .map((discussion) => serializeDiscussionActivity(discussion, papersById, discussionsById))
    .sort(compareRecordsByActivityDesc("activity_at"));
  const myAnnotations = [...annotationSpeeches, ...discussionSpeeches].sort(
    compareRecordsByActivityDesc("activity_at")
  );
  const annotationReplies = annotations
    .filter((annotation) => {
      if (!isReplyAnnotation(annotation)) {
        return false;
      }

      if (doesRecordBelongToUser(annotation, currentUser)) {
        return false;
      }

      const parentAnnotation =
        annotationsById.get(annotation.parent_annotation_id) ||
        annotationsById.get(getThreadRootAnnotationId(annotation));
      return doesRecordBelongToUser(parentAnnotation, currentUser);
    })
    .map((annotation) => serializeReplyNotification(annotation, papersById, annotationsById))
    .sort(compareRecordsByActivityDesc("activity_at"));
  const discussionReplies = discussions
    .filter((discussion) => {
      if (!isDiscussionReply(discussion)) {
        return false;
      }

      if (doesRecordBelongToUser(discussion, currentUser)) {
        return false;
      }

      const parentDiscussion =
        discussionsById.get(discussion.parent_discussion_id) ||
        discussionsById.get(getThreadRootDiscussionId(discussion));
      return doesRecordBelongToUser(parentDiscussion, currentUser);
    })
    .map((discussion) =>
      serializeDiscussionReplyNotification(discussion, papersById, discussionsById)
    )
    .sort(compareRecordsByActivityDesc("activity_at"));
  const repliesToMyAnnotations = [...annotationReplies, ...discussionReplies].sort(
    compareRecordsByActivityDesc("activity_at")
  );

  return {
    uploadedPapers,
    myAnnotations,
    repliesToMyAnnotations,
  };
}

async function getPublicUserProfile(userId) {
  const users = await readJsonFile(USERS_FILE, []);
  const user = users.find((item) => item.id === userId);

  if (!user) {
    throw new HttpError(404, "用户不存在");
  }

  const dashboard = await getUserDashboard(user);

  return {
    user: serializeUser(user),
    uploadedPapers: dashboard.uploadedPapers,
    annotations: dashboard.myAnnotations,
  };
}

async function saveAnnotation(paperId, body, currentUser) {
  const note = String(body.note || "").trim();
  const exact = String(body.exact || "");
  const prefix = String(body.prefix || "");
  const suffix = String(body.suffix || "");
  const targetScope = String(body.target_scope || "body").trim() || "body";
  const startOffset = Number(body.start_offset);
  const endOffset = Number(body.end_offset);
  const attachmentDrafts = parseAttachmentDrafts(body.attachments);

  if (!note && attachmentDrafts.length === 0) {
    throw new Error("批注内容和附件不能同时为空");
  }

  if (!exact.trim()) {
    throw new Error("批注锚点不能为空");
  }

  if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || startOffset >= endOffset) {
    throw new Error("批注偏移量不合法");
  }

  const annotations = await readAnnotations();
  const attachments = await persistAttachmentDrafts(attachmentDrafts);

  try {
    const nextAnnotation = {
      id: createAnnotationId(),
      paperId,
      note,
      exact,
      prefix,
      suffix,
      target_scope: targetScope,
      start_offset: startOffset,
      end_offset: endOffset,
      created_by_user_id: currentUser.id,
      created_by_username: currentUser.username,
      created_at: new Date().toISOString(),
      parent_annotation_id: "",
      root_annotation_id: "",
      attachments,
    };

    annotations.push(nextAnnotation);
    await writeAnnotations(annotations);
    return normalizeAnnotationRecord(nextAnnotation);
  } catch (error) {
    await deleteAttachmentFiles(attachments);
    throw error;
  }
}

async function saveAnnotationReply(annotationId, body, currentUser) {
  const note = String(body.note || "").trim();
  const attachmentDrafts = parseAttachmentDrafts(body.attachments);

  if (!note && attachmentDrafts.length === 0) {
    throw new Error("回复内容和附件不能同时为空");
  }

  const annotations = await readAnnotations();
  const annotationsById = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const parentAnnotation = annotationsById.get(annotationId);

  if (!parentAnnotation) {
    throw new HttpError(404, "批注不存在");
  }

  const rootAnnotation =
    annotationsById.get(getThreadRootAnnotationId(parentAnnotation)) || parentAnnotation;
  const attachments = await persistAttachmentDrafts(attachmentDrafts);

  try {
    const nextReply = normalizeAnnotationRecord({
      id: createAnnotationId(),
      paperId: parentAnnotation.paperId,
      note,
      exact: rootAnnotation.exact,
      prefix: rootAnnotation.prefix,
      suffix: rootAnnotation.suffix,
      target_scope: rootAnnotation.target_scope,
      start_offset: rootAnnotation.start_offset,
      end_offset: rootAnnotation.end_offset,
      created_by_user_id: currentUser.id,
      created_by_username: currentUser.username,
      created_at: new Date().toISOString(),
      parent_annotation_id: parentAnnotation.id,
      root_annotation_id: rootAnnotation.id,
      attachments,
    });

    annotations.push(nextReply);
    await writeAnnotations(annotations);
    return nextReply;
  } catch (error) {
    await deleteAttachmentFiles(attachments);
    throw error;
  }
}

async function saveDiscussion(paperId, body, currentUser) {
  const note = String(body.note || "").trim();
  const attachmentDrafts = parseAttachmentDrafts(body.attachments);

  if (!note && attachmentDrafts.length === 0) {
    throw new Error("讨论内容和附件不能同时为空");
  }

  const discussions = await readDiscussions();
  const attachments = await persistAttachmentDrafts(attachmentDrafts);

  try {
    const nextDiscussion = normalizeDiscussionRecord({
      id: createDiscussionId(),
      paperId,
      note,
      created_by_user_id: currentUser.id,
      created_by_username: currentUser.username,
      created_at: new Date().toISOString(),
      parent_discussion_id: "",
      root_discussion_id: "",
      attachments,
    });

    discussions.push(nextDiscussion);
    await writeDiscussions(discussions);
    return nextDiscussion;
  } catch (error) {
    await deleteAttachmentFiles(attachments);
    throw error;
  }
}

async function saveDiscussionReply(discussionId, body, currentUser) {
  const note = String(body.note || "").trim();
  const attachmentDrafts = parseAttachmentDrafts(body.attachments);

  if (!note && attachmentDrafts.length === 0) {
    throw new Error("回复内容和附件不能同时为空");
  }

  const discussions = await readDiscussions();
  const discussionsById = new Map(discussions.map((discussion) => [discussion.id, discussion]));
  const parentDiscussion = discussionsById.get(discussionId);

  if (!parentDiscussion) {
    throw new HttpError(404, "讨论不存在");
  }

  const rootDiscussion =
    discussionsById.get(getThreadRootDiscussionId(parentDiscussion)) || parentDiscussion;
  const attachments = await persistAttachmentDrafts(attachmentDrafts);

  try {
    const nextReply = normalizeDiscussionRecord({
      id: createDiscussionId(),
      paperId: parentDiscussion.paperId,
      note,
      created_by_user_id: currentUser.id,
      created_by_username: currentUser.username,
      created_at: new Date().toISOString(),
      parent_discussion_id: parentDiscussion.id,
      root_discussion_id: rootDiscussion.id,
      attachments,
    });

    discussions.push(nextReply);
    await writeDiscussions(discussions);
    return nextReply;
  } catch (error) {
    await deleteAttachmentFiles(attachments);
    throw error;
  }
}

async function updateAnnotationById(annotationId, body, currentUser) {
  const note = String(body.note || "").trim();

  const annotations = await readAnnotations();
  const annotationIndex = annotations.findIndex((item) => item.id === annotationId);

  if (annotationIndex < 0) {
    throw new HttpError(404, "批注不存在");
  }

  const annotation = annotations[annotationIndex];

  if (!canDeleteAnnotation(annotation, currentUser)) {
    throw new HttpError(
      403,
      isReplyAnnotation(annotation) ? "无权编辑该回复" : "无权编辑该批注"
    );
  }

  const { attachments, createdAttachments, deletedAttachments } = await resolveUpdatedAttachments(
    body.attachments,
    annotation.attachments
  );

  if (!note && attachments.length === 0) {
    throw new Error("批注内容和附件不能同时为空");
  }

  const updatedAnnotation = normalizeAnnotationRecord({
    ...annotation,
    note,
    attachments,
  });

  annotations[annotationIndex] = updatedAnnotation;

  try {
    await writeAnnotations(annotations);
  } catch (error) {
    await deleteAttachmentFiles(createdAttachments);
    throw error;
  }

  await deleteAttachmentFiles(deletedAttachments);
  return updatedAnnotation;
}

async function updateDiscussionById(discussionId, body, currentUser) {
  const note = String(body.note || "").trim();

  const discussions = await readDiscussions();
  const discussionIndex = discussions.findIndex((item) => item.id === discussionId);

  if (discussionIndex < 0) {
    throw new HttpError(404, "讨论不存在");
  }

  const discussion = discussions[discussionIndex];

  if (!canDeleteDiscussion(discussion, currentUser)) {
    throw new HttpError(
      403,
      isDiscussionReply(discussion) ? "无权编辑该回复" : "无权编辑该讨论"
    );
  }

  const { attachments, createdAttachments, deletedAttachments } = await resolveUpdatedAttachments(
    body.attachments,
    discussion.attachments
  );

  if (!note && attachments.length === 0) {
    throw new Error("讨论内容和附件不能同时为空");
  }

  const updatedDiscussion = normalizeDiscussionRecord({
    ...discussion,
    note,
    attachments,
  });

  discussions[discussionIndex] = updatedDiscussion;

  try {
    await writeDiscussions(discussions);
  } catch (error) {
    await deleteAttachmentFiles(createdAttachments);
    throw error;
  }

  await deleteAttachmentFiles(deletedAttachments);
  return updatedDiscussion;
}

async function deletePaperById(paperId, currentUser) {
  const [papers, annotations, discussions] = await Promise.all([
    readPapers(),
    readJsonFile(ANNOTATIONS_FILE, []),
    readJsonFile(DISCUSSIONS_FILE, []),
  ]);
  const paper = papers.find((item) => item.id === paperId);

  if (!paper) {
    throw new HttpError(404, "文献不存在");
  }

  if (!canDeletePaper(paper, currentUser)) {
    throw new HttpError(403, "无权删除该文献");
  }

  const nextPapers = papers.filter((item) => item.id !== paperId);
  const nextAnnotations = annotations.filter((annotation) => annotation.paperId !== paperId);
  const nextDiscussions = discussions.filter((discussion) => discussion.paperId !== paperId);

  await Promise.all([
    writeJsonFile(PAPERS_FILE, nextPapers),
    writeJsonFile(ANNOTATIONS_FILE, nextAnnotations),
    writeJsonFile(DISCUSSIONS_FILE, nextDiscussions),
    removePaperSnapshot(paper.snapshotPath),
    deleteAttachmentsForRecords([...annotations, ...discussions].filter((record) => record.paperId === paperId)),
  ]);

  return {
    ok: true,
    paperId,
    deletedAnnotationCount: annotations.length - nextAnnotations.length,
    deletedDiscussionCount: discussions.length - nextDiscussions.length,
  };
}

async function deleteAnnotationById(annotationId, currentUser) {
  const annotations = await readAnnotations();
  const annotation = annotations.find((item) => item.id === annotationId);

  if (!annotation) {
    throw new HttpError(404, "批注不存在");
  }

  if (!canDeleteAnnotation(annotation, currentUser)) {
    throw new HttpError(403, "无权删除该批注");
  }

  let nextAnnotations = annotations;
  const deletedIds = new Set([annotationId]);
  let deletedRecords = [annotation];

  if (!isReplyAnnotation(annotation)) {
    annotations.forEach((item) => {
      if (getThreadRootAnnotationId(item) === annotationId) {
        deletedIds.add(item.id);
      }
    });

    nextAnnotations = annotations.filter((item) => !deletedIds.has(item.id));
    deletedRecords = annotations.filter((item) => deletedIds.has(item.id));
  } else {
    const fallbackParentId =
      String(annotation.parent_annotation_id || "").trim() || getThreadRootAnnotationId(annotation);
    nextAnnotations = annotations
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
  }

  await Promise.all([
    writeAnnotations(nextAnnotations),
    deleteAttachmentsForRecords(deletedRecords),
  ]);

  return {
    ok: true,
    annotationId,
    paperId: annotation.paperId,
    deletedCount: deletedIds.size,
  };
}

async function deleteDiscussionById(discussionId, currentUser) {
  const discussions = await readDiscussions();
  const discussion = discussions.find((item) => item.id === discussionId);

  if (!discussion) {
    throw new HttpError(404, "讨论不存在");
  }

  if (!canDeleteDiscussion(discussion, currentUser)) {
    throw new HttpError(403, "无权删除该讨论");
  }

  let nextDiscussions = discussions;
  const deletedIds = new Set([discussionId]);
  let deletedRecords = [discussion];

  if (!isDiscussionReply(discussion)) {
    discussions.forEach((item) => {
      if (getThreadRootDiscussionId(item) === discussionId) {
        deletedIds.add(item.id);
      }
    });

    nextDiscussions = discussions.filter((item) => !deletedIds.has(item.id));
    deletedRecords = discussions.filter((item) => deletedIds.has(item.id));
  } else {
    const fallbackParentId =
      String(discussion.parent_discussion_id || "").trim() ||
      getThreadRootDiscussionId(discussion);
    nextDiscussions = discussions
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
  }

  await Promise.all([
    writeDiscussions(nextDiscussions),
    deleteAttachmentsForRecords(deletedRecords),
  ]);

  return {
    ok: true,
    discussionId,
    paperId: discussion.paperId,
    deletedCount: deletedIds.size,
  };
}

async function clearAnnotationsByPaperId(paperId, currentUser) {
  const annotations = await readAnnotations();
  const ownedThreadIds = new Set(
    annotations
      .filter(
        (annotation) =>
          annotation.paperId === paperId &&
          !isReplyAnnotation(annotation) &&
          doesRecordBelongToUser(annotation, currentUser)
      )
      .map((annotation) => annotation.id)
  );
  const ownedReplyIds = new Set(
    annotations
      .filter(
        (annotation) =>
          annotation.paperId === paperId &&
          isReplyAnnotation(annotation) &&
          doesRecordBelongToUser(annotation, currentUser)
      )
      .map((annotation) => annotation.id)
  );
  const nextAnnotations = annotations.filter((annotation) => {
    if (annotation.paperId !== paperId) {
      return true;
    }

    if (ownedThreadIds.has(getThreadRootAnnotationId(annotation))) {
      return false;
    }

    return !ownedReplyIds.has(annotation.id);
  });
  const deletedAnnotations = annotations.filter((annotation) => !nextAnnotations.includes(annotation));
  await Promise.all([
    writeAnnotations(nextAnnotations),
    deleteAttachmentsForRecords(deletedAnnotations),
  ]);
  return annotations.length - nextAnnotations.length;
}

async function readAnnotations() {
  const annotations = await readJsonFile(ANNOTATIONS_FILE, []);
  return annotations.map(normalizeAnnotationRecord);
}

async function writeAnnotations(annotations) {
  await writeJsonFile(
    ANNOTATIONS_FILE,
    annotations
      .map(normalizeAnnotationRecord)
      .sort(compareAnnotationsByCreatedAt)
  );
}

async function readDiscussions() {
  const discussions = await readJsonFile(DISCUSSIONS_FILE, []);
  return discussions.map(normalizeDiscussionRecord);
}

async function writeDiscussions(discussions) {
  await writeJsonFile(
    DISCUSSIONS_FILE,
    discussions
      .map(normalizeDiscussionRecord)
      .sort(compareDiscussionsByCreatedAt)
  );
}

async function ensureStorageFiles() {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.mkdir(HTML_DIR, { recursive: true });
  await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });

  await ensureJsonFile(PAPERS_FILE);
  await ensureJsonFile(ANNOTATIONS_FILE);
  await ensureJsonFile(DISCUSSIONS_FILE);
  await ensureJsonFile(USERS_FILE);
  await ensureJsonFile(SESSIONS_FILE);
  await ensureDefaultUsers();
}

async function ensureJsonFile(filePath) {
  try {
    await fs.access(filePath);
  } catch (error) {
    await fs.writeFile(filePath, "[]\n", "utf8");
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function ensureDefaultUsers() {
  const users = await readJsonFile(USERS_FILE, []);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const usersByUsername = new Map(users.map((user) => [user.username, user]));
  let changed = false;

  for (const defaultUser of DEFAULT_USERS) {
    const existingUser = usersById.get(defaultUser.id) || usersByUsername.get(defaultUser.username);

    if (!existingUser) {
      users.push(defaultUser);
      changed = true;
      continue;
    }

    const nextRole = defaultUser.role || getUserRole(existingUser);
    const nextCreatedAt = existingUser.createdAt || defaultUser.createdAt;

    if (existingUser.role !== nextRole || existingUser.createdAt !== nextCreatedAt) {
      const userIndex = users.findIndex((user) => user.id === existingUser.id);
      users[userIndex] = {
        ...existingUser,
        role: nextRole,
        createdAt: nextCreatedAt,
      };
      changed = true;
    }
  }

  if (changed) {
    await writeJsonFile(USERS_FILE, users);
  }
}

async function serveStaticAsset(pathname, response) {
  const targetPath = pathname === "/" ? "/index.html" : pathname;
  const relativeTargetPath = decodeURIComponent(targetPath).replace(/^[/\\]+/, "");
  const normalizedPath = path.normalize(relativeTargetPath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(ROOT_DIR, normalizedPath);

  if (!absolutePath.startsWith(ROOT_DIR) || isForbiddenStaticPath(normalizedPath)) {
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
    const contentType = MIME_TYPES[fileExtension] || "application/octet-stream";
    const content = await fs.readFile(absolutePath);

    response.writeHead(200, { "Content-Type": contentType });
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
  const boundary = getMultipartBoundary(contentType);

  if (!boundary) {
    throw new Error("multipart 请求缺少 boundary");
  }

  const rawBody = await readRequestBody(request);
  const { fields, files } = parseMultipartFormData(rawBody, boundary);
  const retainedAttachments = parseMultipartJsonField(fields.retainedAttachments, "保留附件格式不合法");

  return {
    ...fields,
    attachments: [
      ...normalizeRetainedAttachments(retainedAttachments),
      ...files.map(createMultipartAttachmentDraft),
    ],
  };
}

function getMultipartBoundary(contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return (match?.[1] || match?.[2] || "").trim();
}

function parseMultipartFormData(buffer, boundary) {
  const normalizedBoundary = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = buffer.indexOf(normalizedBoundary);

  if (cursor < 0) {
    throw new Error("multipart 请求格式不合法");
  }

  cursor += normalizedBoundary.length;

  while (cursor < buffer.length) {
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) {
      break;
    }

    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) {
      cursor += 2;
    }

    const nextBoundaryIndex = buffer.indexOf(normalizedBoundary, cursor);

    if (nextBoundaryIndex < 0) {
      throw new Error("multipart 请求格式不完整");
    }

    let partBuffer = buffer.slice(cursor, nextBoundaryIndex);

    if (partBuffer[partBuffer.length - 2] === 13 && partBuffer[partBuffer.length - 1] === 10) {
      partBuffer = partBuffer.slice(0, -2);
    }

    parts.push(parseMultipartPart(partBuffer));
    cursor = nextBoundaryIndex + normalizedBoundary.length;
  }

  const fields = {};
  const files = [];

  parts.forEach((part) => {
    if (!part.name) {
      return;
    }

    if (part.filename) {
      files.push(part);
      return;
    }

    fields[part.name] = part.data.toString("utf8");
  });

  return { fields, files };
}

function parseMultipartPart(partBuffer) {
  const headerSeparator = Buffer.from("\r\n\r\n");
  const headerEndIndex = partBuffer.indexOf(headerSeparator);

  if (headerEndIndex < 0) {
    throw new Error("multipart 分段缺少头信息");
  }

  const headerText = partBuffer.slice(0, headerEndIndex).toString("utf8");
  const data = partBuffer.slice(headerEndIndex + headerSeparator.length);
  const headers = headerText.split("\r\n");
  const disposition = headers.find((line) => /^content-disposition:/i.test(line));
  const typeHeader = headers.find((line) => /^content-type:/i.test(line));

  if (!disposition) {
    throw new Error("multipart 分段缺少 Content-Disposition");
  }

  return {
    name: getDispositionValue(disposition, "name"),
    filename: getDispositionValue(disposition, "filename"),
    contentType: typeHeader ? typeHeader.split(":").slice(1).join(":").trim() : "",
    data,
  };
}

function getDispositionValue(disposition, key) {
  const pattern = new RegExp(`${key}="([^"]*)"`, "i");
  return disposition.match(pattern)?.[1] || "";
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

async function readPapers() {
  const papers = await readJsonFile(PAPERS_FILE, []);
  return papers.map(normalizePaperRecord);
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

function attachPaperSpeechStats(papers, annotations, discussions = []) {
  const activityByPaperId = new Map();

  [...annotations, ...discussions].forEach((speech) => {
    const paperId = String(speech?.paperId || "").trim();

    if (!paperId) {
      return;
    }

    const currentStats = activityByPaperId.get(paperId) || {
      speechCount: 0,
      latestSpeechAt: "",
      latestSpeakerUsername: "",
    };
    const nextSpeechCount = currentStats.speechCount + 1;
    const annotationTime = new Date(speech.created_at || 0).getTime();
    const currentLatestTime = new Date(currentStats.latestSpeechAt || 0).getTime();
    const shouldReplaceLatest =
      Number.isFinite(annotationTime) &&
      (!currentStats.latestSpeechAt || annotationTime >= currentLatestTime);

    activityByPaperId.set(paperId, {
      speechCount: nextSpeechCount,
      latestSpeechAt: shouldReplaceLatest ? speech.created_at || "" : currentStats.latestSpeechAt,
      latestSpeakerUsername: shouldReplaceLatest
        ? String(speech.created_by_username || "").trim()
        : currentStats.latestSpeakerUsername,
    });
  });

  return papers.map((paper) => {
    const stats = activityByPaperId.get(String(paper.id || "").trim());

    return normalizePaperRecord({
      ...paper,
      speechCount: stats?.speechCount || 0,
      latestSpeechAt: stats?.latestSpeechAt || "",
      latestSpeakerUsername: stats?.latestSpeakerUsername || "",
    });
  });
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

function serializeAnnotationActivity(annotation, papersById, annotationsById) {
  const paper = papersById.get(annotation.paperId) || null;
  const rootAnnotation =
    annotationsById.get(getThreadRootAnnotationId(annotation)) || annotation;
  const parentAnnotation =
    annotationsById.get(annotation.parent_annotation_id) || rootAnnotation;

  return {
    ...annotation,
    speech_type: "annotation",
    is_reply: isReplyAnnotation(annotation),
    thread_id: rootAnnotation.id,
    thread_annotation_id: rootAnnotation.id,
    thread_note: rootAnnotation.note,
    parent_username: isReplyAnnotation(annotation) ? parentAnnotation.created_by_username || "" : "",
    parent_note: isReplyAnnotation(annotation) ? parentAnnotation.note : "",
    paperTitle: paper?.title || "文献已删除",
    paperSourceUrl: paper?.sourceUrl || "",
    paperPublished: paper?.published || "",
    paperExists: Boolean(paper),
    activity_at: annotation.created_at,
  };
}

function serializeReplyNotification(annotation, papersById, annotationsById) {
  const baseRecord = serializeAnnotationActivity(annotation, papersById, annotationsById);

  return {
    ...baseRecord,
    reply_to_username: baseRecord.parent_username || "",
    reply_to_note: baseRecord.parent_note || "",
  };
}

function serializeDiscussionActivity(discussion, papersById, discussionsById) {
  const paper = papersById.get(discussion.paperId) || null;
  const rootDiscussion =
    discussionsById.get(getThreadRootDiscussionId(discussion)) || discussion;
  const parentDiscussion =
    discussionsById.get(discussion.parent_discussion_id) || rootDiscussion;

  return {
    ...discussion,
    speech_type: "discussion",
    is_reply: isDiscussionReply(discussion),
    thread_id: rootDiscussion.id,
    thread_discussion_id: rootDiscussion.id,
    thread_note: rootDiscussion.note,
    parent_username: isDiscussionReply(discussion)
      ? parentDiscussion.created_by_username || ""
      : "",
    parent_note: isDiscussionReply(discussion) ? parentDiscussion.note : "",
    paperTitle: paper?.title || "文献已删除",
    paperSourceUrl: paper?.sourceUrl || "",
    paperPublished: paper?.published || "",
    paperExists: Boolean(paper),
    activity_at: discussion.created_at,
  };
}

function serializeDiscussionReplyNotification(discussion, papersById, discussionsById) {
  const baseRecord = serializeDiscussionActivity(discussion, papersById, discussionsById);

  return {
    ...baseRecord,
    reply_to_username: baseRecord.parent_username || "",
    reply_to_note: baseRecord.parent_note || "",
  };
}

function compareAnnotationsByCreatedAt(left, right) {
  return new Date(left.created_at || 0) - new Date(right.created_at || 0);
}

function compareDiscussionsByCreatedAt(left, right) {
  return new Date(left.created_at || 0) - new Date(right.created_at || 0);
}

function compareRecordsByActivityDesc(fieldName) {
  return (left, right) => new Date(right?.[fieldName] || 0) - new Date(left?.[fieldName] || 0);
}

function compareUsersForDisplay(left, right) {
  const roleDifference = Number(getUserRole(right) === "admin") - Number(getUserRole(left) === "admin");

  if (roleDifference) {
    return roleDifference;
  }

  return String(left.username || "").localeCompare(String(right.username || ""), "zh-CN");
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

function parseAttachmentDraft(rawAttachment, index, currentTotalBytes = 0) {
  const originalName = sanitizeAttachmentName(
    rawAttachment?.name || rawAttachment?.original_name || ""
  );
  const mimeType = normalizeMimeType(rawAttachment?.mimeType || rawAttachment?.mime_type || "");
  const contentBase64 = stripBase64Prefix(
    rawAttachment?.contentBase64 || rawAttachment?.content_base64 || ""
  );
  const multipartBuffer = Buffer.isBuffer(rawAttachment?.buffer) ? rawAttachment.buffer : null;

  if (!originalName) {
    throw new Error(`第 ${index + 1} 个附件缺少文件名`);
  }

  if (!contentBase64 && !multipartBuffer) {
    throw new Error(`第 ${index + 1} 个附件缺少文件内容`);
  }

  let fileBuffer;

  if (multipartBuffer) {
    fileBuffer = multipartBuffer;
  } else {
    try {
      fileBuffer = Buffer.from(contentBase64, "base64");
    } catch (error) {
      throw new Error(`第 ${index + 1} 个附件内容无法解析`);
    }
  }

  if (!fileBuffer.length) {
    throw new Error(`第 ${index + 1} 个附件内容为空`);
  }

  if (fileBuffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`附件“${originalName}”超过 ${formatLimitInMb(MAX_ATTACHMENT_BYTES)} MB 限制`);
  }

  if (currentTotalBytes + fileBuffer.length > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(`附件总大小不能超过 ${formatLimitInMb(MAX_TOTAL_ATTACHMENT_BYTES)} MB`);
  }

  const { category, extension, mimeType: resolvedMimeType } = resolveAttachmentDescriptor(
    originalName,
    mimeType
  );

  return {
    originalName,
    category,
    extension,
    mimeType: resolvedMimeType,
    sizeBytes: fileBuffer.length,
    buffer: fileBuffer,
  };
}

function parseAttachmentDrafts(rawAttachments) {
  if (rawAttachments == null) {
    return [];
  }

  if (!Array.isArray(rawAttachments)) {
    throw new Error("附件格式不合法");
  }

  if (rawAttachments.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`单次最多上传 ${MAX_ATTACHMENT_COUNT} 个附件`);
  }

  let totalBytes = 0;

  return rawAttachments.map((attachment, index) => {
    const draft = parseAttachmentDraft(attachment, index, totalBytes);
    totalBytes += draft.sizeBytes;
    return draft;
  });
}

function getAttachmentLookupKeys(attachment) {
  const normalizedAttachment = normalizeAttachmentRecord(attachment);

  return [normalizedAttachment.id, normalizedAttachment.storage_path, normalizedAttachment.url].filter(
    Boolean
  );
}

function resolveCurrentAttachmentSelection(rawAttachment, existingAttachmentsByKey) {
  for (const key of getAttachmentLookupKeys(rawAttachment)) {
    const matchedAttachment = existingAttachmentsByKey.get(key);

    if (matchedAttachment) {
      return matchedAttachment;
    }
  }

  return null;
}

async function resolveUpdatedAttachments(rawAttachments, currentAttachments) {
  const existingAttachments = normalizeAttachmentRecords(currentAttachments);

  if (rawAttachments == null) {
    return {
      attachments: existingAttachments,
      createdAttachments: [],
      deletedAttachments: [],
    };
  }

  if (!Array.isArray(rawAttachments)) {
    throw new Error("附件格式不合法");
  }

  if (rawAttachments.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`单次最多上传 ${MAX_ATTACHMENT_COUNT} 个附件`);
  }

  const existingAttachmentsByKey = new Map();

  existingAttachments.forEach((attachment) => {
    getAttachmentLookupKeys(attachment).forEach((key) => {
      existingAttachmentsByKey.set(key, attachment);
    });
  });

  let totalBytes = 0;
  const retainedAttachments = [];
  const retainedStoragePaths = new Set();
  const attachmentDrafts = [];

  rawAttachments.forEach((attachment, index) => {
    const retainedAttachment = resolveCurrentAttachmentSelection(
      attachment,
      existingAttachmentsByKey
    );

    if (retainedAttachment) {
      if (retainedStoragePaths.has(retainedAttachment.storage_path)) {
        return;
      }

      totalBytes += retainedAttachment.size_bytes || 0;

      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        throw new Error(`附件总大小不能超过 ${formatLimitInMb(MAX_TOTAL_ATTACHMENT_BYTES)} MB`);
      }

      retainedAttachments.push(retainedAttachment);
      retainedStoragePaths.add(retainedAttachment.storage_path);
      return;
    }

    const draft = parseAttachmentDraft(attachment, index, totalBytes);
    totalBytes += draft.sizeBytes;
    attachmentDrafts.push(draft);
  });

  const createdAttachments = await persistAttachmentDrafts(attachmentDrafts);

  return {
    attachments: [...retainedAttachments, ...createdAttachments],
    createdAttachments,
    deletedAttachments: existingAttachments.filter(
      (attachment) => !retainedStoragePaths.has(attachment.storage_path)
    ),
  };
}

async function persistAttachmentDrafts(attachmentDrafts) {
  if (!attachmentDrafts.length) {
    return [];
  }

  await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });

  return Promise.all(
    attachmentDrafts.map(async (draft) => {
      const attachmentId = createAttachmentId();
      const storedFilename = `${attachmentId}${draft.extension}`;
      const storagePath = path.posix.join("attachments", storedFilename);
      const absolutePath = resolveStorageAbsolutePath(storagePath);
      const createdAt = new Date().toISOString();

      await fs.writeFile(absolutePath, draft.buffer);

      return normalizeAttachmentRecord({
        id: attachmentId,
        category: draft.category,
        filename: storedFilename,
        original_name: draft.originalName,
        mime_type: draft.mimeType,
        extension: draft.extension,
        size_bytes: draft.sizeBytes,
        storage_path: storagePath,
        created_at: createdAt,
      });
    })
  );
}

async function deleteAttachmentsForRecords(records) {
  const attachments = [];

  for (const record of records || []) {
    attachments.push(...normalizeAttachmentRecords(record?.attachments));
  }

  await deleteAttachmentFiles(attachments);
}

async function deleteAttachmentFiles(attachments) {
  const uniqueStoragePaths = [...new Set(
    normalizeAttachmentRecords(attachments).map((attachment) => attachment.storage_path)
  )].filter(Boolean);

  await Promise.all(
    uniqueStoragePaths.map(async (storagePath) => {
      const absolutePath = resolveStorageAbsolutePath(storagePath);

      try {
        await fs.unlink(absolutePath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    })
  );
}

function stripBase64Prefix(value) {
  return String(value || "").replace(/^data:[^;,]+;base64,/i, "").trim();
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

function serializeSessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
}

function serializeExpiredSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: getUserRole(user),
    createdAt: user.createdAt || "",
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

function assertAdminUser(user) {
  if (!isAdminUser(user)) {
    throw new HttpError(403, "仅管理员可执行此操作");
  }
}

function canDeletePaper(paper, user) {
  return canDeleteOwnedRecord(paper, user);
}

function canDeleteAnnotation(annotation, user) {
  return canDeleteOwnedRecord(annotation, user);
}

function canDeleteDiscussion(discussion, user) {
  return canDeleteAnnotation(discussion, user);
}

async function removePaperSnapshot(snapshotPath) {
  if (!snapshotPath) {
    return;
  }

  const snapshotAbsolutePath = path.join(STORAGE_DIR, snapshotPath);

  try {
    await fs.unlink(snapshotAbsolutePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function fetchElsevierObjectBinary(eid, mimeType) {
  const normalizedEid = String(eid || "").trim();
  const normalizedMimeType = normalizeMimeType(mimeType);
  const apiKey = resolveElsevierApiKey();

  if (!normalizedEid || !/^[\w.:-]+$/i.test(normalizedEid)) {
    throw new HttpError(400, "Elsevier 对象参数无效。");
  }

  if (!normalizedMimeType.startsWith("image/")) {
    throw new HttpError(400, "仅支持代理 Elsevier 图片资源。");
  }

  if (!apiKey) {
    throw new HttpError(503, "当前服务器未配置 Elsevier API key。");
  }

  const requestUrl = new URL(`${ELSEVIER_OBJECT_API_BASE_URL}/${encodeURIComponent(normalizedEid)}`);
  requestUrl.searchParams.set("httpAccept", normalizedMimeType);

  const response = await fetch(requestUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: {
      "X-ELS-APIKey": apiKey,
      accept: normalizedMimeType,
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, "Elsevier 图片请求被拒绝，请检查 API key 权限。");
    }

    if (response.status === 404) {
      throw new HttpError(404, "Elsevier 图片不存在。");
    }

    throw new HttpError(502, `Elsevier 图片请求失败：HTTP ${response.status}`);
  }

  const contentType = normalizeMimeType(response.headers.get("content-type")) || normalizedMimeType;

  if (!contentType.startsWith("image/")) {
    throw new HttpError(502, "Elsevier 返回的资源不是图片。");
  }

  return {
    contentType,
    content: Buffer.from(await response.arrayBuffer()),
  };
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function hashPassword(password) {
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

module.exports = {
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
    const contentType = MIME_TYPES[fileExtension] || "application/octet-stream";
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

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("Vary", "Origin");
}

function isTlsCertificateError(error) {
  const code = error?.cause?.code || error?.code || "";

  return [
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_GET_ISSUER_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  ].includes(code);
}
