import * as sharedModule from "../../../shared/papershare-shared.js";
import temmlModule from "temml";
import {
  getTopLevelAnnotations,
  normalizeAnnotationScope,
} from "../shared/speech-helpers.js";

const shared = sharedModule?.default || sharedModule;
const temml = temmlModule?.default || temmlModule;
const {
  parsePreloadedStateFromHtml,
  safeParseHostname,
  stripBackgroundImagesFromInlineStyle,
  supportsArticleImagesForSourceUrl,
} = shared;

const CONTEXT_RADIUS = 40;

export function readPaperRouteFromQuery(search = getWindowLocation()?.search || "") {
  const params = new URLSearchParams(search || "");
  const panel = params.get("panel") === "discussion" ? "discussion" : "reader";

  return {
    paperId: params.get("paperId")?.trim() || "",
    panel,
    annotationId: params.get("annotationId")?.trim() || "",
    replyId: params.get("replyId")?.trim() || "",
    discussionId: params.get("discussionId")?.trim() || "",
    discussionReplyId: params.get("discussionReplyId")?.trim() || "",
  };
}

export function readPaperIdFromHash(hash = getWindowLocation()?.hash || "") {
  return decodeURIComponent(String(hash || "").replace(/^#/, "").trim());
}

export function writePaperIdToHash(paperId) {
  const nextHash = paperId ? `#${encodeURIComponent(paperId)}` : "";
  const location = getWindowLocation();
  const history = getWindowHistory();

  if (!location || !history || location.hash === nextHash) {
    return;
  }

  history.replaceState(null, "", nextHash);
}

export function supportsArticleImages(paper) {
  if (!paper) {
    return false;
  }

  if (typeof paper.articleImagesEnabled === "boolean") {
    return paper.articleImagesEnabled;
  }

  return supportsArticleImagesForSourceUrl(paper.sourceUrl);
}

export function extractReadableArticleHtml(rawHtml, baseUrl, options = {}) {
  const parser = new DOMParser();
  const documentSnapshot = parser.parseFromString(rawHtml, "text/html");
  const resolvedBaseUrl = resolveArticleBaseUrl(documentSnapshot, baseUrl);
  const preloadedState = parsePreloadedStateFromHtml(rawHtml);
  const allowImages = options.allowImages !== false;
  const buildUrl = options.buildApiUrl;

  if (isScienceDirectSnapshot(documentSnapshot, preloadedState)) {
    const scienceDirectHtml = extractScienceDirectArticleHtml(
      documentSnapshot,
      resolvedBaseUrl,
      preloadedState,
      { allowImages, buildApiUrl: buildUrl }
    );

    if (scienceDirectHtml) {
      return scienceDirectHtml;
    }
  }

  const article =
    documentSnapshot.querySelector("main.c-article-main-column article") ||
    documentSnapshot.querySelector("article") ||
    documentSnapshot.querySelector("main") ||
    documentSnapshot.body;

  if (!article) {
    return "";
  }

  const articleBody = article.querySelector(".c-article-body") || article;
  const bodyClone = articleBody.cloneNode(true);
  sanitizeArticleBody(bodyClone);
  absolutizeNodeUrls(bodyClone, resolvedBaseUrl, buildUrl);
  enforceArticleImagePolicy(bodyClone, { allowImages });
  return bodyClone.innerHTML;
}

export function renderArticleMath(root) {
  if (!root || typeof temml?.renderMathInElement !== "function") {
    return;
  }

  normalizeLegacyArticleMath(root);

  try {
    temml.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\begin{equation}", right: "\\end{equation}", display: true },
        { left: "\\begin{equation*}", right: "\\end{equation*}", display: true },
        { left: "\\begin{align}", right: "\\end{align}", display: true },
        { left: "\\begin{align*}", right: "\\end{align*}", display: true },
        { left: "\\begin{gather}", right: "\\end{gather}", display: true },
        { left: "\\begin{gather*}", right: "\\end{gather*}", display: true },
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
      ignoredClasses: ["annotation-highlight", "pending-selection-highlight"],
      throwOnError: false,
      errorCallback(message, error) {
        console.warn(message, error);
      },
    });
  } catch (error) {
    console.error("Failed to render article math.", error);
  }
}

export function installArticleImageFallbacks(root, sourceUrl) {
  if (!root) {
    return;
  }

  root.querySelectorAll("img").forEach((img) => {
    if (img.dataset.paperShareFallbackBound === "true") {
      return;
    }

    img.dataset.paperShareFallbackBound = "true";

    const handleError = () => {
      renderArticleImageFallback(img, sourceUrl);
    };

    img.addEventListener("error", handleError);

    if (shouldRenderArticleImageFallback(img)) {
      handleError();
    }
  });
}

export function restoreAnnotationHighlights(root, annotations, options = {}) {
  if (!root) {
    return;
  }

  clearHighlightMarks(root);

  getTopLevelAnnotations(annotations).forEach((annotation) => {
    const resolvedOffsets = resolveAnnotationOffsets(root, annotation);

    if (!resolvedOffsets) {
      return;
    }

    applyOffsetsHighlight(
      getAnnotationScopeRoot(root, annotation.target_scope),
      resolvedOffsets.start,
      resolvedOffsets.end,
      (mark) => {
        mark.className = "annotation-highlight";
        mark.dataset.annotationId = annotation.id;
        mark.title = "点击查看批注";

        if (annotation.id === options.activeAnnotationId) {
          mark.classList.add("active");
        }
      }
    );
  });

  if (options.pendingSelection) {
    const pendingScopeRoot = getAnnotationScopeRoot(
      root,
      options.pendingSelection.target_scope
    );

    if (pendingScopeRoot) {
      applyOffsetsHighlight(
        pendingScopeRoot,
        Number(options.pendingSelection.start_offset || 0),
        Number(options.pendingSelection.end_offset || 0),
        (mark) => {
          mark.className = "pending-selection-highlight";
          mark.title = "待保存选区";
        }
      );
    }
  }
}

export function capturePendingSelection(root) {
  const selection = getWindowSelection();

  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const scopeRoot = getAnnotationScopeRootFromNode(root, range.commonAncestorContainer);

  if (!scopeRoot) {
    return null;
  }

  const scope = getAnnotationScopeFromRoot(scopeRoot);
  const offsets = getRangeTextOffsets(scopeRoot, range);
  const startOffset = Math.min(offsets.startOffset, offsets.endOffset);
  const endOffset = Math.max(offsets.startOffset, offsets.endOffset);
  const fullText = getScopeText(scopeRoot);
  const exact = fullText.slice(startOffset, endOffset);

  if (!exact.trim()) {
    return null;
  }

  return {
    target_scope: scope,
    exact,
    prefix: fullText.slice(Math.max(0, startOffset - CONTEXT_RADIUS), startOffset),
    suffix: fullText.slice(endOffset, Math.min(fullText.length, endOffset + CONTEXT_RADIUS)),
    start_offset: startOffset,
    end_offset: endOffset,
  };
}

export function hasSelectionOverlap(annotations, pendingSelection) {
  if (!pendingSelection) {
    return false;
  }

  return getTopLevelAnnotations(annotations).some(
    (annotation) =>
      normalizeAnnotationScope(annotation.target_scope) ===
        normalizeAnnotationScope(pendingSelection.target_scope) &&
      Number(pendingSelection.start_offset || 0) < Number(annotation.end_offset || 0) &&
      Number(pendingSelection.end_offset || 0) > Number(annotation.start_offset || 0)
  );
}

function getWindowLocation() {
  return typeof window === "undefined" ? null : window.location;
}

function getWindowHistory() {
  return typeof window === "undefined" ? null : window.history;
}

function getWindowSelection() {
  return typeof window === "undefined" || typeof window.getSelection !== "function"
    ? null
    : window.getSelection();
}

function isScienceDirectSnapshot(documentSnapshot, preloadedState) {
  const canonicalUrl =
    documentSnapshot.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
  const hostname = safeParseHostname(canonicalUrl);

  return (
    hostname.includes("sciencedirect.com") ||
    Boolean(preloadedState?.article?.eid) ||
    Boolean(preloadedState?.article?.ajaxLinks?.body)
  );
}

function extractScienceDirectArticleHtml(documentSnapshot, baseUrl, preloadedState, options = {}) {
  const container = documentSnapshot.createElement("div");
  const textContent = documentSnapshot.querySelector(".text-content");
  const textClone = textContent ? textContent.cloneNode(true) : null;

  if (textClone) {
    sanitizeArticleBody(textClone);
    absolutizeNodeUrls(textClone, baseUrl, options.buildApiUrl);
    enforceArticleImagePolicy(textClone, options);
  }

  const extractedText = textClone?.textContent?.replace(/\s+/g, " ").trim() || "";
  const bodyUnavailable =
    hasScienceDirectDeferredBody(preloadedState) &&
    (!extractedText || hasOnlyAuxiliaryScienceDirectSections(textClone));

  if (bodyUnavailable) {
    container.appendChild(createScienceDirectBodyNotice(documentSnapshot));
  }

  if (textClone && extractedText) {
    while (textClone.firstChild) {
      container.appendChild(textClone.firstChild);
    }
  }

  return container.innerHTML.trim();
}

function hasScienceDirectDeferredBody(preloadedState) {
  if (!preloadedState) {
    return false;
  }

  const bodyKeys = Object.keys(preloadedState.body || {});
  const previewKeys = Object.keys(preloadedState.preview || {});
  const rawText = String(preloadedState.rawtext || "").trim();

  return (
    Boolean(preloadedState?.article?.ajaxLinks?.body) &&
    bodyKeys.length === 0 &&
    previewKeys.length === 0 &&
    !rawText
  );
}

function hasOnlyAuxiliaryScienceDirectSections(root) {
  if (!root) {
    return true;
  }

  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4"))
    .map((heading) => heading.textContent.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);

  if (!headings.length) {
    return true;
  }

  return headings.every((heading) =>
    [
      "data availability",
      "code availability",
      "acknowledgements",
      "acknowledgments",
      "funding",
      "declaration of competing interest",
      "declaration of generative ai and ai-assisted technologies in the writing process",
      "references",
      "appendix",
      "supplementary data",
      "supplementary materials",
    ].includes(heading)
  );
}

function createScienceDirectBodyNotice(documentSnapshot) {
  const notice = documentSnapshot.createElement("section");
  notice.className = "empty-state";
  notice.innerHTML = [
    "<p>当前保存的 ScienceDirect 页面源码没有包含正文全文，只带了作者、摘要和少量附加信息。</p>",
    "<p>这通常是因为正文是在页面加载后再单独请求的，所以这份源码本身不足以还原完整正文。</p>",
  ].join("");
  return notice;
}

function resolveArticleBaseUrl(documentSnapshot, baseUrl) {
  const baseHref = documentSnapshot.querySelector("base[href]")?.getAttribute("href");

  if (baseHref) {
    try {
      return new URL(baseHref, baseUrl).toString();
    } catch (error) {
      return baseUrl;
    }
  }

  const canonicalUrl = documentSnapshot
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");

  if (canonicalUrl) {
    try {
      return new URL(canonicalUrl, baseUrl).toString();
    } catch (error) {
      return baseUrl;
    }
  }

  const ogUrl = documentSnapshot
    .querySelector('meta[property="og:url"]')
    ?.getAttribute("content");

  if (ogUrl) {
    try {
      return new URL(ogUrl, baseUrl).toString();
    } catch (error) {
      return baseUrl;
    }
  }

  return baseUrl;
}

function sanitizeArticleBody(root) {
  root
    .querySelectorAll(
      [
        "script",
        "style",
        "noscript",
        "iframe",
        "button",
        "form",
        "footer",
        "nav",
        ".advertisement",
        ".c-article-recommendations",
        ".js-context-bar-sticky-point-mobile",
        ".u-hide",
        ".u-visually-hidden",
      ].join(", ")
    )
    .forEach((element) => element.remove());

  root.querySelectorAll("header").forEach((element) => {
    if (isFigureOrTableHeader(element)) {
      return;
    }

    element.remove();
  });

  root.querySelectorAll("[hidden]").forEach((element) => element.remove());
  removeAbstractSection(root);
}

function normalizeLegacyArticleMath(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];

  while (walker.nextNode()) {
    const textNode = walker.currentNode;

    if (
      !textNode.nodeValue ||
      (!textNode.nodeValue.includes("\\mathop \\sum \\limits") &&
        !textNode.nodeValue.includes("\\mathop \\sum \\nolimits"))
    ) {
      continue;
    }

    textNodes.push(textNode);
  }

  textNodes.forEach((textNode) => {
    textNode.nodeValue = textNode.nodeValue
      .replaceAll("\\mathop \\sum \\limits", "\\sum \\limits")
      .replaceAll("\\mathop \\sum \\nolimits", "\\sum \\nolimits");
  });
}

function filterArticleFigures(root) {
  const figureSelectors = [
    "figure",
    ".figure",
    ".figure-wrap",
    ".figure__container",
    ".c-article-figure",
    ".o-figure",
    ".article-figure",
    "[data-figure]",
  ];
  const figureSelector = figureSelectors.join(", ");
  const isInsideFigure = (node) => Boolean(node.closest?.(figureSelector));

  const isLikelyNonFigureImage = (img) => {
    const src = String(img.getAttribute("src") || "").toLowerCase();
    const alt = String(img.getAttribute("alt") || "").toLowerCase();
    const className = String(img.getAttribute("class") || "").toLowerCase();
    const parentLink = img.closest("a");
    const href = String(parentLink?.getAttribute("href") || "").toLowerCase();

    if (isTransparentPlaceholder(src)) {
      return true;
    }

    if (href.includes(".pdf") || src.includes(".pdf")) {
      return true;
    }

    return /logo|cover|icon|spinner|loading|placeholder/.test(
      [src, alt, className].join(" ")
    );
  };

  root.querySelectorAll("img").forEach((img) => {
    if (!isInsideFigure(img) || isLikelyNonFigureImage(img)) {
      img.remove();
    }
  });

  root.querySelectorAll("picture, source").forEach((node) => {
    if (!isInsideFigure(node)) {
      node.remove();
    }
  });

  root.querySelectorAll(figureSelector).forEach((figure) => {
    const hasMedia = figure.querySelector("img, picture, svg, canvas");

    if (!hasMedia) {
      figure.remove();
    }
  });
}

function enforceArticleImagePolicy(root, options = {}) {
  if (!root) {
    return;
  }

  if (options.allowImages === false) {
    removeArticleFigureMedia(root);
    return;
  }

  filterArticleFigures(root);
}

function removeArticleFigureMedia(root) {
  const figureSelectors = [
    "figure",
    ".figure",
    ".figure-wrap",
    ".figure__container",
    ".c-article-figure",
    ".o-figure",
    ".article-figure",
    "[data-figure]",
  ];
  const figureSelector = figureSelectors.join(", ");

  root.querySelectorAll(figureSelector).forEach((figure) => {
    figure.remove();
  });

  root
    .querySelectorAll("img, picture, source, svg, canvas, video, audio, object, embed, image")
    .forEach((element) => {
      element.remove();
    });

  [
    "src",
    "srcset",
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-zoom-src",
    "data-hires",
    "data-srcset",
    "poster",
  ].forEach((attribute) => {
    root.querySelectorAll(`[${attribute}]`).forEach((element) => {
      element.removeAttribute(attribute);
    });
  });

  root.querySelectorAll("[style]").forEach((element) => {
    const sanitizedStyle = stripBackgroundImagesFromInlineStyle(element.getAttribute("style") || "");

    if (sanitizedStyle) {
      element.setAttribute("style", sanitizedStyle);
      return;
    }

    element.removeAttribute("style");
  });
}

function isFigureOrTableHeader(element) {
  if (!element) {
    return false;
  }

  if (element.closest("figure, .figure, .figure-wrap, .table-wrap, table")) {
    return true;
  }

  return Boolean(
    element.querySelector(
      [".label", ".figure__label", ".table__label", "[data-figure-label]", "[data-table-label]"].join(
        ", "
      )
    )
  );
}

function removeAbstractSection(root) {
  root
    .querySelectorAll(
      [
        "#abstract",
        ".abstract",
        ".article__abstract",
        ".c-article-section__abstract",
        '[data-title="Abstract"]',
        '[aria-labelledby*="abstract"]',
      ].join(", ")
    )
    .forEach((element) => element.remove());

  root.querySelectorAll("section, div").forEach((element) => {
    const heading = element.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4");

    if (!heading) {
      return;
    }

    const headingText = heading.textContent.replace(/\s+/g, " ").trim().toLowerCase();

    if (headingText === "abstract" || headingText === "摘要") {
      element.remove();
    }
  });
}

function absolutizeNodeUrls(root, baseUrl, buildApiUrl) {
  const attributes = ["href", "src", "poster"];
  const dataAttributes = ["data-src", "data-original", "data-lazy-src", "data-zoom-src", "data-hires"];

  for (const attribute of attributes) {
    root.querySelectorAll(`[${attribute}]`).forEach((element) => {
      const value = element.getAttribute(attribute);
      const normalizedValue = absolutizeUrl(value, baseUrl, buildApiUrl);

      if (normalizedValue) {
        element.setAttribute(attribute, normalizedValue);
      }
    });
  }

  for (const attribute of dataAttributes) {
    root.querySelectorAll(`[${attribute}]`).forEach((element) => {
      const value = element.getAttribute(attribute);
      const normalizedValue = absolutizeUrl(value, baseUrl, buildApiUrl);

      if (normalizedValue) {
        element.setAttribute(attribute, normalizedValue);
      }
    });
  }

  root.querySelectorAll("[srcset]").forEach((element) => {
    const srcset = element.getAttribute("srcset");

    if (!srcset) {
      return;
    }

    const normalizedSrcset = srcset
      .split(",")
      .map((candidate) => {
        const [url, descriptor] = candidate.trim().split(/\s+/, 2);
        const normalizedUrl = absolutizeUrl(url, baseUrl, buildApiUrl);
        return normalizedUrl ? [normalizedUrl, descriptor].filter(Boolean).join(" ") : candidate;
      })
      .join(", ");

    element.setAttribute("srcset", normalizedSrcset);
  });

  root.querySelectorAll("[data-srcset]").forEach((element) => {
    const srcset = element.getAttribute("data-srcset");

    if (!srcset) {
      return;
    }

    const normalizedSrcset = srcset
      .split(",")
      .map((candidate) => {
        const [url, descriptor] = candidate.trim().split(/\s+/, 2);
        const normalizedUrl = absolutizeUrl(url, baseUrl, buildApiUrl);
        return normalizedUrl ? [normalizedUrl, descriptor].filter(Boolean).join(" ") : candidate;
      })
      .join(", ");

    element.setAttribute("data-srcset", normalizedSrcset);
  });

  hydrateLazyImages(root);
}

function absolutizeUrl(value, baseUrl, buildApiUrl) {
  if (
    !value ||
    value.startsWith("data:") ||
    value.startsWith("mailto:") ||
    value.startsWith("tel:") ||
    value.startsWith("javascript:")
  ) {
    return value;
  }

  if ((value.startsWith("/api/") || value.startsWith("/storage/")) && typeof buildApiUrl === "function") {
    return buildApiUrl(value);
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch (error) {
    return value;
  }
}

function hydrateLazyImages(root) {
  root.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";

    if (src && !isTransparentPlaceholder(src)) {
      return;
    }

    const lazySource =
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-zoom-src") ||
      img.getAttribute("data-hires");

    if (lazySource) {
      img.setAttribute("src", lazySource);
    }
  });

  root.querySelectorAll("source").forEach((source) => {
    const srcset = source.getAttribute("srcset") || "";

    if (srcset) {
      return;
    }

    const lazySrcset = source.getAttribute("data-srcset");

    if (lazySrcset) {
      source.setAttribute("srcset", lazySrcset);
    }
  });
}

function shouldRenderArticleImageFallback(img) {
  if (!img || !img.isConnected || !img.complete) {
    return false;
  }

  const imageUrl = String(img.currentSrc || img.getAttribute("src") || "").trim();

  if (!imageUrl || isTransparentPlaceholder(imageUrl)) {
    return false;
  }

  return img.naturalWidth === 0;
}

function renderArticleImageFallback(img, sourceUrl) {
  if (!img || !img.isConnected) {
    return;
  }

  const fallbackHost = resolveArticleImageFallbackHost(img);

  if (!fallbackHost || fallbackHost.dataset.paperShareFallbackShown === "true") {
    return;
  }

  fallbackHost.dataset.paperShareFallbackShown = "true";
  fallbackHost.hidden = true;

  const fallback = document.createElement("div");
  fallback.className = "article-image-fallback";

  const message = document.createElement("p");
  message.className = "article-image-fallback-text";
  message.textContent =
    "图片加载不出来？点击“原文网址”，待新界面加载完成，再刷新本页面即可显示图片。（原文网址可能需要登录/人机验证）";
  fallback.append(message);

  if (sourceUrl) {
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "ghost-button article-image-fallback-button";
    actionButton.textContent = "原文网址";
    actionButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.open(sourceUrl, "_blank", "noopener,noreferrer");
    });
    fallback.append(actionButton);
  }

  fallbackHost.insertAdjacentElement("beforebegin", fallback);
}

function resolveArticleImageFallbackHost(img) {
  if (!img) {
    return null;
  }

  const picture = img.closest("picture");
  const anchor = img.closest("a");

  if (
    anchor &&
    anchor.childElementCount === 1 &&
    (anchor.firstElementChild === img || anchor.firstElementChild === picture)
  ) {
    return anchor;
  }

  return picture || img;
}

function isTransparentPlaceholder(value) {
  return value.startsWith("data:image") && /transparent|blank|1x1|pixel/i.test(value);
}

function getAnnotationScopeRoot(root, scope) {
  if (!root) {
    return null;
  }

  return root.querySelector(`[data-annotation-scope="${normalizeAnnotationScope(scope)}"]`);
}

function getAnnotationScopeRootFromNode(root, node) {
  if (!root || !node) {
    return null;
  }

  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const scopeRoot = element?.closest?.("[data-annotation-scope]") || null;

  return scopeRoot && root.contains(scopeRoot) ? scopeRoot : null;
}

function getAnnotationScopeFromRoot(root) {
  return normalizeAnnotationScope(root?.dataset?.annotationScope);
}

function resolveAnnotationOffsets(root, annotation) {
  const scopeRoot = getAnnotationScopeRoot(root, annotation?.target_scope);

  if (!scopeRoot) {
    return null;
  }

  const fullText = getScopeText(scopeRoot);
  const startOffset = Number(annotation?.start_offset || 0);
  const endOffset = Number(annotation?.end_offset || 0);
  const offsetMatch = fullText.slice(startOffset, endOffset);

  if (offsetMatch === annotation?.exact) {
    return {
      start: startOffset,
      end: endOffset,
    };
  }

  const fallbackStart = fullText.indexOf(annotation?.exact || "");

  if (fallbackStart === -1) {
    return null;
  }

  const candidates = [];
  let searchFrom = 0;

  while (searchFrom !== -1) {
    const candidateStart = fullText.indexOf(annotation?.exact || "", searchFrom);

    if (candidateStart === -1) {
      break;
    }

    const candidateEnd = candidateStart + String(annotation?.exact || "").length;
    const prefix = fullText.slice(
      Math.max(0, candidateStart - String(annotation?.prefix || "").length),
      candidateStart
    );
    const suffix = fullText.slice(
      candidateEnd,
      candidateEnd + String(annotation?.suffix || "").length
    );
    const prefixMatches = !annotation?.prefix || prefix === annotation.prefix;
    const suffixMatches = !annotation?.suffix || suffix === annotation.suffix;

    if (prefixMatches && suffixMatches) {
      candidates.push({
        start: candidateStart,
        end: candidateEnd,
      });
    }

    searchFrom = candidateStart + 1;
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  return {
    start: fallbackStart,
    end: fallbackStart + String(annotation?.exact || "").length,
  };
}

function clearHighlightMarks(root) {
  root.querySelectorAll(".annotation-highlight, .pending-selection-highlight").forEach((highlight) => {
    const parent = highlight.parentNode;

    if (!parent) {
      return;
    }

    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight);
    }

    parent.removeChild(highlight);
    parent.normalize();
  });
}

function applyOffsetsHighlight(root, startOffset, endOffset, decorateMark) {
  const segments = resolveSegmentsFromOffsets(root, startOffset, endOffset);

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const range = document.createRange();
    range.setStart(segment.node, segment.start);
    range.setEnd(segment.node, segment.end);

    const mark = document.createElement("mark");
    decorateMark(mark);
    range.surroundContents(mark);
  }
}

function resolveSegmentsFromOffsets(root, startOffset, endOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments = [];
  let currentNode = walker.nextNode();
  let cursor = 0;

  while (currentNode) {
    const nodeLength = currentNode.textContent.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + nodeLength;
    const overlapStart = Math.max(nodeStart, startOffset);
    const overlapEnd = Math.min(nodeEnd, endOffset);

    if (overlapStart < overlapEnd) {
      segments.push({
        node: currentNode,
        start: overlapStart - nodeStart,
        end: overlapEnd - nodeStart,
      });
    }

    cursor = nodeEnd;
    currentNode = walker.nextNode();
  }

  return segments;
}

function getRangeTextOffsets(root, range) {
  const startRange = document.createRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = document.createRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    startOffset: startRange.toString().length,
    endOffset: endRange.toString().length,
  };
}

function getScopeText(root) {
  return root?.textContent || "";
}
