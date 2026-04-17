import {
  parsePreloadedStateFromHtml,
  safeParseHostname,
  stripBackgroundImagesFromInlineStyle,
  supportsArticleImagesForSourceUrl,
} from "../../../shared/papershare-shared";
import {
  getTopLevelAnnotations,
  normalizeAnnotationScope,
} from "../shared/speech-helpers";
import type { Annotation, Paper, PendingSelection } from "../shared/types";

type TemmlModule = {
  renderMathInElement?: (
    root: HTMLElement,
    options: {
      delimiters: Array<{ left: string; right: string; display: boolean }>;
      ignoredTags: string[];
      ignoredClasses: string[];
      throwOnError: boolean;
      errorCallback(message: string, error: unknown): void;
    }
  ) => void;
};

type ScienceDirectState = Record<string, unknown> | null;

let temmlPromise: Promise<TemmlModule> | null = null;

async function loadTemml() {
  if (temmlPromise) {
    return temmlPromise;
  }

  temmlPromise = import("temml").then((module) => module.default || module);
  return temmlPromise;
}

const CONTEXT_RADIUS = 40;

export interface PaperRoute {
  paperId: string;
  panel: "discussion" | "reader";
  annotationId: string;
  replyId: string;
  discussionId: string;
  discussionReplyId: string;
}

export function readPaperRouteFromQuery(search: string = getWindowLocation()?.search || ""): PaperRoute {
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

export function readPaperIdFromHash(hash: string = getWindowLocation()?.hash || ""): string {
  return decodeURIComponent(String(hash || "").replace(/^#/, "").trim());
}

export function writePaperIdToHash(paperId: string): void {
  const nextHash = paperId ? `#${encodeURIComponent(paperId)}` : "";
  const location = getWindowLocation();
  const history = getWindowHistory();

  if (!location || !history || location.hash === nextHash) {
    return;
  }

  history.replaceState(null, "", nextHash);
}

export function supportsArticleImages(paper: Paper | null | undefined): boolean {
  if (!paper) {
    return false;
  }

  if (typeof paper.articleImagesEnabled === "boolean") {
    return paper.articleImagesEnabled;
  }

  return supportsArticleImagesForSourceUrl(paper.sourceUrl || "");
}

export function extractReadableArticleHtml(rawHtml: string, baseUrl: string, options: { allowImages?: boolean; buildApiUrl?: (path: string) => string } = {}): string {
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
  const bodyClone = articleBody.cloneNode(true) as HTMLElement;
  sanitizeArticleBody(bodyClone);
  absolutizeNodeUrls(bodyClone, resolvedBaseUrl, buildUrl);
  enforceArticleImagePolicy(bodyClone, { allowImages });
  return bodyClone.innerHTML;
}

export async function renderArticleMath(root: HTMLElement | null): Promise<void> {
  if (!root) {
    return;
  }

  const temml = await loadTemml();

  if (!temml || typeof temml.renderMathInElement !== "function") {
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
      errorCallback(message: string, error: unknown) {
        console.warn(message, error);
      },
    });
  } catch (error) {
    console.error("Failed to render article math.", error);
  }
}

export function installArticleImageFallbacks(root: HTMLElement | null, sourceUrl: string): void {
  if (!root) {
    return;
  }

  root.querySelectorAll("img").forEach((img: HTMLImageElement) => {
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

export function restoreAnnotationHighlights(
  root: HTMLElement | null,
  annotations: Annotation[],
  options: { activeAnnotationId?: string | null; pendingSelection?: PendingSelection | null } = {}
): void {
  if (!root) {
    return;
  }

  clearHighlightMarks(root);

  getTopLevelAnnotations(annotations).forEach((annotation) => {
    const resolvedOffsets = resolveAnnotationOffsets(root, annotation);

    if (!resolvedOffsets) {
      return;
    }

    const scopeRoot = getAnnotationScopeRoot(root, annotation.target_scope);
    if (!scopeRoot) return;

    applyOffsetsHighlight(
      scopeRoot,
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

export function capturePendingSelection(root: HTMLElement | null): PendingSelection | null {
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

export function hasSelectionOverlap(
  annotations: Annotation[],
  pendingSelection: PendingSelection | null
): boolean {
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

function getWindowLocation(): Location | null {
  return typeof window === "undefined" ? null : window.location;
}

function getWindowHistory(): History | null {
  return typeof window === "undefined" ? null : window.history;
}

function getWindowSelection(): Selection | null {
  return typeof window === "undefined" || typeof window.getSelection !== "function"
    ? null
    : window.getSelection();
}

function isScienceDirectSnapshot(
  documentSnapshot: Document,
  preloadedState: ScienceDirectState
): boolean {
  const canonicalUrl =
    documentSnapshot.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
  const hostname = safeParseHostname(canonicalUrl);

  return (
    hostname.includes("sciencedirect.com") ||
    Boolean(readNestedString(preloadedState, ["article", "eid"])) ||
    Boolean(readNestedString(preloadedState, ["article", "ajaxLinks", "body"]))
  );
}

function extractScienceDirectArticleHtml(
  documentSnapshot: Document,
  baseUrl: string,
  preloadedState: ScienceDirectState,
  options: { allowImages?: boolean; buildApiUrl?: (path: string) => string } = {}
): string {
  const container = documentSnapshot.createElement("div");
  const textContent = documentSnapshot.querySelector(".text-content");
  const textClone = textContent ? (textContent.cloneNode(true) as HTMLElement) : null;

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

function hasScienceDirectDeferredBody(preloadedState: ScienceDirectState): boolean {
  if (!preloadedState) {
    return false;
  }

  const bodyKeys = Object.keys(readNestedObject(preloadedState, ["body"]));
  const previewKeys = Object.keys(readNestedObject(preloadedState, ["preview"]));
  const rawText = readNestedString(preloadedState, ["rawtext"]).trim();

  return (
    Boolean(readNestedString(preloadedState, ["article", "ajaxLinks", "body"])) &&
    bodyKeys.length === 0 &&
    previewKeys.length === 0 &&
    !rawText
  );
}

function hasOnlyAuxiliaryScienceDirectSections(root: HTMLElement | null): boolean {
  if (!root) {
    return true;
  }

  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4"))
    .map((heading) => heading.textContent?.replace(/\s+/g, " ").trim().toLowerCase())
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
    ].includes(heading as string)
  );
}

function createScienceDirectBodyNotice(documentSnapshot: Document): HTMLElement {
  const notice = documentSnapshot.createElement("section");
  notice.className = "empty-state";
  notice.innerHTML = [
    "<p>当前保存的 ScienceDirect 页面源码没有包含正文全文，只带了作者、摘要和少量附加信息。</p>",
    "<p>这通常是因为正文是在页面加载后再单独请求的，所以这份源码本身不足以还原完整正文。</p>",
  ].join("");
  return notice;
}

function resolveArticleBaseUrl(documentSnapshot: Document, baseUrl: string): string {
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

function sanitizeArticleBody(root: HTMLElement): void {
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

  root.querySelectorAll("header").forEach((element: HTMLElement) => {
    if (isFigureOrTableHeader(element)) {
      return;
    }

    element.remove();
  });

  root.querySelectorAll("[hidden]").forEach((element) => element.remove());
  removeAbstractSection(root);
}

function normalizeLegacyArticleMath(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;

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
    if (textNode.nodeValue) {
      textNode.nodeValue = textNode.nodeValue
        .replaceAll("\\mathop \\sum \\limits", "\\sum \\limits")
        .replaceAll("\\mathop \\sum \\nolimits", "\\sum \\nolimits");
    }
  });
}

function filterArticleFigures(root: HTMLElement): void {
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
  const isInsideFigure = (node: HTMLElement) => Boolean(node.closest?.(figureSelector));

  const isLikelyNonFigureImage = (img: HTMLImageElement) => {
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

  root.querySelectorAll("img").forEach((img: HTMLImageElement) => {
    if (!isInsideFigure(img) || isLikelyNonFigureImage(img)) {
      img.remove();
    }
  });

  root.querySelectorAll("picture, source").forEach((node) => {
    if (!isInsideFigure(node as HTMLElement)) {
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

function enforceArticleImagePolicy(root: HTMLElement, options: { allowImages?: boolean } = {}): void {
  if (!root) {
    return;
  }

  if (options.allowImages === false) {
    removeArticleFigureMedia(root);
    return;
  }

  filterArticleFigures(root);
}

function removeArticleFigureMedia(root: HTMLElement): void {
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

function isFigureOrTableHeader(element: HTMLElement): boolean {
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

function removeAbstractSection(root: HTMLElement): void {
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

    const headingText = heading.textContent?.replace(/\s+/g, " ").trim().toLowerCase();

    if (headingText === "abstract" || headingText === "摘要") {
      element.remove();
    }
  });
}

function absolutizeNodeUrls(root: HTMLElement, baseUrl: string, buildApiUrl?: (path: string) => string): void {
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

function absolutizeUrl(value: string | null, baseUrl: string, buildApiUrl?: (path: string) => string): string | null {
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

function hydrateLazyImages(root: HTMLElement): void {
  root.querySelectorAll("img").forEach((img: HTMLImageElement) => {
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

  root.querySelectorAll("source").forEach((source: HTMLSourceElement) => {
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

function shouldRenderArticleImageFallback(img: HTMLImageElement): boolean {
  if (!img || !img.isConnected || !img.complete) {
    return false;
  }

  const imageUrl = String(img.currentSrc || img.getAttribute("src") || "").trim();

  if (!imageUrl || isTransparentPlaceholder(imageUrl)) {
    return false;
  }

  return img.naturalWidth === 0;
}

function renderArticleImageFallback(img: HTMLImageElement, sourceUrl: string): void {
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

function resolveArticleImageFallbackHost(img: HTMLImageElement): HTMLElement | null {
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

  return (picture || img) as HTMLElement;
}

function isTransparentPlaceholder(value: string): boolean {
  return value.startsWith("data:image") && /transparent|blank|1x1|pixel/i.test(value);
}

function getAnnotationScopeRoot(root: HTMLElement, scope: string | undefined): HTMLElement | null {
  if (!root) {
    return null;
  }

  return root.querySelector(`[data-annotation-scope="${normalizeAnnotationScope(scope)}"]`) as HTMLElement | null;
}

function getAnnotationScopeRootFromNode(root: HTMLElement, node: Node | null): HTMLElement | null {
  if (!root || !node) {
    return null;
  }

  const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  const scopeRoot = element?.closest?.("[data-annotation-scope]") || null;

  return scopeRoot && root.contains(scopeRoot) ? (scopeRoot as HTMLElement) : null;
}

function getAnnotationScopeFromRoot(root: HTMLElement): string {
  return normalizeAnnotationScope(root?.dataset?.annotationScope);
}

function resolveAnnotationOffsets(root: HTMLElement, annotation: Annotation): { start: number, end: number } | null {
  const scopeRoot = getAnnotationScopeRoot(root, annotation?.target_scope);

  if (!scopeRoot) {
    return null;
  }

  const fullText = getScopeText(scopeRoot);
  const startOffset = Number(annotation?.start_offset || 0);
  const endOffset = Number(annotation.end_offset || 0);
  const exact = annotation.exact || "";
  const offsetMatch = fullText.slice(startOffset, endOffset);

  if (offsetMatch === exact) {
    return {
      start: startOffset,
      end: endOffset,
    };
  }

  const fallbackStart = fullText.indexOf(exact);

  if (fallbackStart === -1) {
    return null;
  }

  const candidates: { start: number, end: number }[] = [];
  let searchFrom = 0;

  while (searchFrom !== -1) {
    const candidateStart = fullText.indexOf(exact, searchFrom);

    if (candidateStart === -1) {
      break;
    }

    const candidateEnd = candidateStart + exact.length;
    const prefix = fullText.slice(
      Math.max(0, candidateStart - String(annotation.prefix || "").length),
      candidateStart
    );
    const suffix = fullText.slice(
      candidateEnd,
      candidateEnd + String(annotation.suffix || "").length
    );
    const prefixMatches = !annotation.prefix || prefix === annotation.prefix;
    const suffixMatches = !annotation.suffix || suffix === annotation.suffix;

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
    end: fallbackStart + exact.length,
  };
}

function clearHighlightMarks(root: HTMLElement): void {
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

function applyOffsetsHighlight(root: HTMLElement, startOffset: number, endOffset: number, decorateMark: (mark: HTMLElement) => void): void {
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

function resolveSegmentsFromOffsets(root: HTMLElement, startOffset: number, endOffset: number): { node: Node, start: number, end: number }[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: { node: Node, start: number, end: number }[] = [];
  let currentNode = walker.nextNode();
  let cursor = 0;

  while (currentNode) {
    const nodeLength = currentNode.textContent?.length || 0;
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

function getRangeTextOffsets(root: HTMLElement, range: Range): { startOffset: number, endOffset: number } {
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

function readNestedObject(
  source: Record<string, unknown> | null,
  path: string[]
): Record<string, unknown> {
  let current: unknown = source;

  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return {};
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current && typeof current === "object" ? (current as Record<string, unknown>) : {};
}

function readNestedString(source: Record<string, unknown> | null, path: string[]): string {
  let current: unknown = source;

  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return "";
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current == null ? "" : String(current);
}

function getScopeText(root: HTMLElement | null): string {
  return root?.textContent || "";
}
