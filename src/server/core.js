const http = require("http");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
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

async function ensureStorageFiles() {
  await ensureAppServices().system.ensureRuntimeReady(DEFAULT_USERS);
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

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
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

function createAppServices() {
  return createServices({
    ANNOTATIONS_FILE,
    ATTACHMENTS_DIR,
    CLIENT_DIST_DIR,
    DISCUSSIONS_FILE,
    HTML_DIR,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_COUNT,
    MAX_TOTAL_ATTACHMENT_BYTES,
    MIME_TYPE_BY_EXTENSION,
    PAPERS_FILE,
    PORT,
    SESSION_COOKIE_NAME,
    STORAGE_DIR,
    STATIC_ASSET_CACHE_CONTROL,
    STATIC_HASHED_ASSET_CACHE_CONTROL,
    STATIC_HTML_CACHE_CONTROL,
    HttpError,
    applyCorsHeaders,
    createAnnotationId,
    createAttachmentId,
    createDiscussionId,
    createPaperId,
    enforceSnapshotArticleImagePolicy,
    formatLimitInMb,
    fs,
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
    sanitizeAttachmentName,
    sendJson,
    normalizeStorageRecordPath,
    store: SQLITE_STORE,
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
