const {
  stripBackgroundImagesFromInlineStyle,
  supportsArticleImagesForSourceUrl,
} = require("../../../shared/papershare-shared");

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

module.exports = {
  enforceSnapshotArticleImagePolicy,
  stripAllArticleImagesFromHtml,
};
