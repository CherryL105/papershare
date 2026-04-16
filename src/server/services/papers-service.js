const { XMLParser } = require("fast-xml-parser");
const {
  canDeleteOwnedRecord,
  escapeHtml,
  normalizeMimeType,
  parsePreloadedStateFromHtml,
  supportsArticleImagesForSourceUrl,
} = require("../../../shared/papershare-shared");
const {
  cleanTextValue,
  decodeHtmlEntities,
  escapeRegExp,
  firstNonEmpty,
  normalizeKeywords,
  splitPeople,
  stripTags,
} = require("../utils/text-utils");

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

function createPapersService(deps) {
  function invalidateDashboard() {
    deps.dashboardService?.invalidateAll?.();
  }

  async function getById(paperId) {
    const paper = deps.store.papers.getById(paperId);
    return paper ? deps.normalizePaperRecord(paper) : null;
  }

  async function getBySourceUrl(sourceUrl) {
    const paper = deps.store.papers.getBySourceUrl(sourceUrl);
    return paper ? deps.normalizePaperRecord(paper) : null;
  }

  async function listWithActivity() {
    return deps.store.papers
      .listWithActivity()
      .map((paper) => deps.normalizePaperRecord(paper));
  }

  async function fetchAndStore(sourceUrl, currentUser, options = {}) {
    const validatedUrl = validateSourceUrl(sourceUrl);
    const normalizedUrl = validatedUrl.toString();
    const existingPaper = await getBySourceUrl(normalizedUrl);
    const elsevierApiKey = resolveElsevierApiKey(options.elsevierApiKey);

    if (existingPaper) {
      throw new deps.HttpError(409, buildDuplicatePaperMessage(existingPaper));
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
        throw new Error("抓取网页失败：目标站点可能启用了人机验证或访问限制。");
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

  async function importFromHtml(sourceUrl, rawHtml, currentUser, options = {}) {
    const validatedUrl = validateSourceUrl(sourceUrl);
    const normalizedUrl = validatedUrl.toString();
    const existingPaper = await getBySourceUrl(normalizedUrl);
    const elsevierApiKey = resolveElsevierApiKey(options.elsevierApiKey);

    if (existingPaper) {
      throw new deps.HttpError(409, buildDuplicatePaperMessage(existingPaper));
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

  async function readSnapshotContent(paperId) {
    const paper = await getById(paperId);

    if (!paper) {
      throw new deps.HttpError(404, "文献不存在");
    }

    if (!paper.snapshotPath) {
      throw new deps.HttpError(404, "当前文献没有网页快照");
    }

    const snapshotPath = deps.path.join(deps.storageDir, paper.snapshotPath);
    const rawHtml = await deps.fs.readFile(snapshotPath, "utf8");

    return {
      rawHtml: deps.enforceSnapshotArticleImagePolicy(rawHtml, paper.sourceUrl),
    };
  }

  async function deleteById(paperId, currentUser) {
    const paper = await getById(paperId);

    if (!paper) {
      throw new deps.HttpError(404, "文献不存在");
    }

    if (!canDeleteOwnedRecord(paper, currentUser)) {
      throw new deps.HttpError(403, "无权删除该文献");
    }

    const annotations = deps.store.annotations
      .listByPaperId(paperId)
      .map((annotation) => deps.normalizeAnnotationRecord(annotation));
    const discussions = deps.store.discussions
      .listByPaperId(paperId)
      .map((discussion) => deps.normalizeDiscussionRecord(discussion));

    deps.store.runInTransaction((repositories) => {
      repositories.annotations.deleteByPaperId(paperId);
      repositories.discussions.deleteByPaperId(paperId);
      repositories.papers.deleteById(paperId);
    });
    invalidateDashboard();

    await Promise.all([
      deleteSnapshotByPath(paper.snapshotPath),
      deps.deleteSpeechAttachmentsForRecords([...annotations, ...discussions]),
    ]);

    return {
      ok: true,
      paperId,
      deletedAnnotationCount: annotations.length,
      deletedDiscussionCount: discussions.length,
    };
  }

  async function fetchElsevierObject(eid, mimeType) {
    const normalizedEid = String(eid || "").trim();
    const normalizedMimeType = normalizeMimeType(mimeType);
    const apiKey = resolveElsevierApiKey();

    if (!normalizedEid || !/^[\w.:-]+$/i.test(normalizedEid)) {
      throw new deps.HttpError(400, "Elsevier 对象参数无效。");
    }

    if (!normalizedMimeType.startsWith("image/")) {
      throw new deps.HttpError(400, "仅支持代理 Elsevier 图片资源。");
    }

    if (!apiKey) {
      throw new deps.HttpError(503, "当前服务器未配置 Elsevier API key。");
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
        throw new deps.HttpError(502, "Elsevier 图片请求被拒绝，请检查 API key 权限。");
      }

      if (response.status === 404) {
        throw new deps.HttpError(404, "Elsevier 图片不存在。");
      }

      throw new deps.HttpError(502, `Elsevier 图片请求失败：HTTP ${response.status}`);
    }

    const contentType = normalizeMimeType(response.headers.get("content-type")) || normalizedMimeType;

    if (!contentType.startsWith("image/")) {
      throw new deps.HttpError(502, "Elsevier 返回的资源不是图片。");
    }

    return {
      contentType,
      content: Buffer.from(await response.arrayBuffer()),
    };
  }

  async function storePaperSnapshot(sourceUrl, rawHtml, currentUser) {
    const existingPaper = await getBySourceUrl(sourceUrl);

    if (existingPaper) {
      throw new deps.HttpError(409, buildDuplicatePaperMessage(existingPaper));
    }

    const paperId = deps.createPaperId();
    const metadata = extractMetadataFromHtml(rawHtml, sourceUrl);
    const now = new Date().toISOString();
    const snapshotRelativePath = deps.path.join("html", `${paperId}.html`).replaceAll("\\", "/");
    const snapshotAbsolutePath = deps.path.join(deps.storageDir, snapshotRelativePath);
    const snapshotHtml = deps.enforceSnapshotArticleImagePolicy(rawHtml, sourceUrl);

    await deps.fs.writeFile(snapshotAbsolutePath, snapshotHtml, "utf8");

    try {
      const nextPaper = deps.normalizePaperRecord({
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

      deps.store.papers.insert(nextPaper);
      invalidateDashboard();
      return nextPaper;
    } catch (error) {
      await deleteSnapshotByPath(snapshotRelativePath);
      throw error;
    }
  }

  async function deleteSnapshotByPath(snapshotPath) {
    if (!snapshotPath) {
      return;
    }

    const snapshotAbsolutePath = deps.path.join(deps.storageDir, snapshotPath);

    try {
      await deps.fs.unlink(snapshotAbsolutePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return {
    deleteById,
    deleteSnapshotByPath,
    fetchAndStore,
    fetchElsevierObject,
    getById,
    importFromHtml,
    listWithActivity,
    readSnapshotContent,
  };
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

async function normalizeImportedArticleContent(sourceUrl, rawContent) {
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
  return extractElsevierLocatorFromUrl(sourceUrl) || extractElsevierLocatorFromHtml(sourceHtml) || null;
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

function isTlsCertificateError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.cause?.code || error?.code || "").toLowerCase();

  return (
    code.startsWith("err_tls") ||
    code === "self_signed_cert_in_chain" ||
    code === "depth_zero_self_signed_cert" ||
    code === "unable_to_verify_leaf_signature" ||
    code === "certificate_has_expired" ||
    code === "hostname_mismatch" ||
    message.includes("certificate") ||
    message.includes("self signed") ||
    message.includes("unable to verify")
  );
}

module.exports = {
  convertElsevierXmlToHtml,
  createPapersService,
  extractMetadataFromHtml,
  fetchElsevierArticleSnapshotHtml,
  resolveElsevierApiKey,
};
