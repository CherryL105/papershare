const http = require("http");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const Busboy = require("busboy");
const { XMLParser } = require("fast-xml-parser");
const { createRouter } = require("./router");
const { createServices } = require("./services");
const { TABLES, createSqliteStore } = require("./storage/sqlite-store");
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
    password: "1234",
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
  const existingPaper = await getPaperBySourceUrl(sourceUrl);

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

  SQLITE_STORE.papers.insert(nextPaper);
  return nextPaper;
}

async function getPaperBySourceUrl(sourceUrl) {
  const paper = SQLITE_STORE.papers.getBySourceUrl(sourceUrl);
  return paper ? normalizePaperRecord(paper) : null;
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
    user: serializeUser(user),
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

  await Promise.all([
    Promise.all(deletedPapers.map((paper) => removePaperSnapshot(paper.snapshotPath))),
    deleteAttachmentsForRecords([...deletedAnnotations, ...deletedDiscussions]),
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

async function getPaperById(paperId) {
  const paper = SQLITE_STORE.papers.getById(paperId);
  return paper ? normalizePaperRecord(paper) : null;
}

async function getAnnotationById(annotationId) {
  const annotation = SQLITE_STORE.annotations.getById(annotationId);
  return annotation ? normalizeAnnotationRecord(annotation) : null;
}

async function getDiscussionById(discussionId) {
  const discussion = SQLITE_STORE.discussions.getById(discussionId);
  return discussion ? normalizeDiscussionRecord(discussion) : null;
}

async function getAnnotationsByPaperId(paperId) {
  return SQLITE_STORE.annotations
    .listByPaperId(paperId)
    .map((annotation) => normalizeAnnotationRecord(annotation));
}

async function getDiscussionsByPaperId(paperId) {
  return SQLITE_STORE.discussions
    .listByPaperId(paperId)
    .map((discussion) => normalizeDiscussionRecord(discussion));
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

    const normalizedAnnotation = normalizeAnnotationRecord(nextAnnotation);
    SQLITE_STORE.runInTransaction((repositories) => {
      repositories.annotations.insert(normalizedAnnotation);
      refreshPaperActivitiesInRepositories(repositories, [paperId]);
    });
    return normalizedAnnotation;
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

  const parentAnnotation = await getAnnotationById(annotationId);

  if (!parentAnnotation) {
    throw new HttpError(404, "批注不存在");
  }

  const rootAnnotation =
    (await getAnnotationById(getThreadRootAnnotationId(parentAnnotation))) || parentAnnotation;
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

    SQLITE_STORE.runInTransaction((repositories) => {
      repositories.annotations.insert(nextReply);
      refreshPaperActivitiesInRepositories(repositories, [parentAnnotation.paperId]);
    });
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

    SQLITE_STORE.runInTransaction((repositories) => {
      repositories.discussions.insert(nextDiscussion);
      refreshPaperActivitiesInRepositories(repositories, [paperId]);
    });
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

  const parentDiscussion = await getDiscussionById(discussionId);

  if (!parentDiscussion) {
    throw new HttpError(404, "讨论不存在");
  }

  const rootDiscussion =
    (await getDiscussionById(getThreadRootDiscussionId(parentDiscussion))) || parentDiscussion;
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

    SQLITE_STORE.runInTransaction((repositories) => {
      repositories.discussions.insert(nextReply);
      refreshPaperActivitiesInRepositories(repositories, [parentDiscussion.paperId]);
    });
    return nextReply;
  } catch (error) {
    await deleteAttachmentFiles(attachments);
    throw error;
  }
}

async function updateAnnotationById(annotationId, body, currentUser) {
  const note = String(body.note || "").trim();
  const annotation = await getAnnotationById(annotationId);

  if (!annotation) {
    throw new HttpError(404, "批注不存在");
  }

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

  try {
    SQLITE_STORE.annotations.update(updatedAnnotation);
  } catch (error) {
    await deleteAttachmentFiles(createdAttachments);
    throw error;
  }

  await deleteAttachmentFiles(deletedAttachments);
  return updatedAnnotation;
}

async function updateDiscussionById(discussionId, body, currentUser) {
  const note = String(body.note || "").trim();
  const discussion = await getDiscussionById(discussionId);

  if (!discussion) {
    throw new HttpError(404, "讨论不存在");
  }

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

  try {
    SQLITE_STORE.discussions.update(updatedDiscussion);
  } catch (error) {
    await deleteAttachmentFiles(createdAttachments);
    throw error;
  }

  await deleteAttachmentFiles(deletedAttachments);
  return updatedDiscussion;
}

async function deletePaperById(paperId, currentUser) {
  const paper = await getPaperById(paperId);

  if (!paper) {
    throw new HttpError(404, "文献不存在");
  }

  if (!canDeletePaper(paper, currentUser)) {
    throw new HttpError(403, "无权删除该文献");
  }

  const [annotations, discussions] = await Promise.all([
    getAnnotationsByPaperId(paperId),
    getDiscussionsByPaperId(paperId),
  ]);

  SQLITE_STORE.runInTransaction((repositories) => {
    repositories.annotations.deleteByPaperId(paperId);
    repositories.discussions.deleteByPaperId(paperId);
    repositories.papers.deleteById(paperId);
  });

  await Promise.all([
    removePaperSnapshot(paper.snapshotPath),
    deleteAttachmentsForRecords([...annotations, ...discussions]),
  ]);

  return {
    ok: true,
    paperId,
    deletedAnnotationCount: annotations.length,
    deletedDiscussionCount: discussions.length,
  };
}

async function deleteAnnotationById(annotationId, currentUser) {
  const annotation = await getAnnotationById(annotationId);

  if (!annotation) {
    throw new HttpError(404, "批注不存在");
  }

  if (!canDeleteAnnotation(annotation, currentUser)) {
    throw new HttpError(403, "无权删除该批注");
  }

  const deletedIds = new Set([annotationId]);
  let deletedRecords = [annotation];

  SQLITE_STORE.runInTransaction((repositories) => {
    if (!isReplyAnnotation(annotation)) {
      const replyRecords = repositories.annotations
        .listByRootId(annotationId)
        .map((record) => normalizeAnnotationRecord(record));
      deletedRecords = dedupeRecordsById([annotation, ...replyRecords]);
      deletedRecords.forEach((record) => deletedIds.add(record.id));
      repositories.annotations.deleteByIds(Array.from(deletedIds));
      refreshPaperActivitiesInRepositories(repositories, [annotation.paperId]);
      return;
    }

    const fallbackParentId =
      String(annotation.parent_annotation_id || "").trim() || getThreadRootAnnotationId(annotation);
    repositories.annotations.reparentChildren(annotationId, fallbackParentId);
    repositories.annotations.deleteById(annotationId);
    refreshPaperActivitiesInRepositories(repositories, [annotation.paperId]);
  });

  await deleteAttachmentsForRecords(deletedRecords);

  return {
    ok: true,
    annotationId,
    paperId: annotation.paperId,
    deletedCount: deletedIds.size,
  };
}

async function deleteDiscussionById(discussionId, currentUser) {
  const discussion = await getDiscussionById(discussionId);

  if (!discussion) {
    throw new HttpError(404, "讨论不存在");
  }

  if (!canDeleteDiscussion(discussion, currentUser)) {
    throw new HttpError(403, "无权删除该讨论");
  }

  const deletedIds = new Set([discussionId]);
  let deletedRecords = [discussion];

  SQLITE_STORE.runInTransaction((repositories) => {
    if (!isDiscussionReply(discussion)) {
      const replyRecords = repositories.discussions
        .listByRootId(discussionId)
        .map((record) => normalizeDiscussionRecord(record));
      deletedRecords = dedupeRecordsById([discussion, ...replyRecords]);
      deletedRecords.forEach((record) => deletedIds.add(record.id));
      repositories.discussions.deleteByIds(Array.from(deletedIds));
      refreshPaperActivitiesInRepositories(repositories, [discussion.paperId]);
      return;
    }

    const fallbackParentId =
      String(discussion.parent_discussion_id || "").trim() ||
      getThreadRootDiscussionId(discussion);
    repositories.discussions.reparentChildren(discussionId, fallbackParentId);
    repositories.discussions.deleteById(discussionId);
    refreshPaperActivitiesInRepositories(repositories, [discussion.paperId]);
  });

  await deleteAttachmentsForRecords(deletedRecords);

  return {
    ok: true,
    discussionId,
    paperId: discussion.paperId,
    deletedCount: deletedIds.size,
  };
}

async function clearAnnotationsByPaperId(paperId, currentUser) {
  const ownedThreadIds = new Set(
    (await getAnnotationsByPaperId(paperId))
      .filter(
        (annotation) =>
          annotation.paperId === paperId &&
          !isReplyAnnotation(annotation) &&
          doesRecordBelongToUser(annotation, currentUser)
      )
      .map((annotation) => annotation.id)
  );
  const ownedReplyIds = new Set(
    (await getAnnotationsByPaperId(paperId))
      .filter(
        (annotation) =>
          annotation.paperId === paperId &&
          isReplyAnnotation(annotation) &&
          doesRecordBelongToUser(annotation, currentUser)
      )
      .map((annotation) => annotation.id)
  );
  const deletedAnnotations = [];

  SQLITE_STORE.runInTransaction((repositories) => {
    ownedThreadIds.forEach((threadId) => {
      const rootAnnotation = repositories.annotations.getById(threadId);

      if (!rootAnnotation) {
        return;
      }

      const threadRecords = dedupeRecordsById([
        normalizeAnnotationRecord(rootAnnotation),
        ...repositories.annotations
          .listByRootId(threadId)
          .map((record) => normalizeAnnotationRecord(record)),
      ]);

      deletedAnnotations.push(...threadRecords);
      repositories.annotations.deleteByIds(threadRecords.map((record) => record.id));
    });

    ownedReplyIds.forEach((replyId) => {
      const reply = repositories.annotations.getById(replyId);

      if (!reply) {
        return;
      }

      const normalizedReply = normalizeAnnotationRecord(reply);
      const fallbackParentId =
        String(normalizedReply.parent_annotation_id || "").trim() ||
        getThreadRootAnnotationId(normalizedReply);

      repositories.annotations.reparentChildren(replyId, fallbackParentId);
      repositories.annotations.deleteById(replyId);
      deletedAnnotations.push(normalizedReply);
    });

    refreshPaperActivitiesInRepositories(repositories, [paperId]);
  });

  const normalizedDeletedAnnotations = dedupeRecordsById(deletedAnnotations);
  await deleteAttachmentsForRecords(normalizedDeletedAnnotations);
  return normalizedDeletedAnnotations.length;
}

async function readAnnotations() {
  return SQLITE_STORE.annotations
    .listAll()
    .map((annotation) => normalizeAnnotationRecord(annotation));
}

async function readDiscussions() {
  return SQLITE_STORE.discussions
    .listAll()
    .map((discussion) => normalizeDiscussionRecord(discussion));
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
      const { password, ...defaultUserRecord } = defaultUser;

      SQLITE_STORE.users.insert({
        ...defaultUserRecord,
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

async function readPapers() {
  return SQLITE_STORE.papers.listAll().map((paper) => normalizePaperRecord(paper));
}

async function listPapersWithActivity() {
  return SQLITE_STORE.papers
    .listWithActivity()
    .map((paper) => normalizePaperRecord(paper));
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
    DISCUSSIONS_FILE,
    PAPERS_FILE,
    PORT,
    STORAGE_DIR,
    HttpError,
    applyCorsHeaders,
    assertAdminUser,
    changeUserPassword,
    changeUsername,
    clearAnnotationsByPaperId,
    createMemberUser,
    deleteAnnotationById,
    deleteDiscussionById,
    deletePaperById,
    deleteSession,
    deleteUserById,
    enforceSnapshotArticleImagePolicy,
    ensureStorageFiles,
    fetchAndStorePaper,
    fetchElsevierObjectBinary,
    fs,
    getAnnotationsByPaperId,
    getCurrentUserFromRequest,
    getDiscussionsByPaperId,
    getJsonCollectionLength,
    getPaperById,
    getSessionTokenFromRequest,
    importPaperFromHtml,
    listPapersWithActivity,
    loginUser,
    normalizeAnnotationRecord,
    normalizeDiscussionRecord,
    normalizeMimeType,
    normalizePaperRecord,
    path,
    readRequestJson,
    readSpeechMutationBody,
    saveAnnotation,
    saveAnnotationReply,
    saveDiscussion,
    saveDiscussionReply,
    sendJson,
    serializeExpiredSessionCookie,
    serializeSessionCookie,
    serializeUser,
    servePrivateStorageAsset,
    serveStaticAsset,
    store: SQLITE_STORE,
    transferAdminRole,
    updateAnnotationById,
    updateDiscussionById,
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

function isTlsCertificateError(error) {
  const code = error?.cause?.code || error?.code || "";

  return [
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_GET_ISSUER_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  ].includes(code);
}
