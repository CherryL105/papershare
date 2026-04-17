const MAX_ATTACHMENT_COUNT = 6;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_INPUT_ACCEPT = "image/*,.csv,.tsv,.xls,.xlsx,.ods";

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
]);

const TABLE_ATTACHMENT_EXTENSIONS = new Set([
  ".csv",
  ".tsv",
  ".xls",
  ".xlsx",
  ".ods",
]);

const DEFAULT_ANNOTATION_SCOPE = "body";

const ANNOTATION_SCOPE_LABELS = Object.freeze({
  title: "标题",
  authors: "作者",
  abstract: "摘要",
  body: "正文",
});

const ARTICLE_IMAGE_SOURCE_RULES = Object.freeze([
  {
    label: "Springer / Nature",
    hostnames: ["nature.com", "springer.com", "springernature.com"],
  },
  {
    label: "Elsevier",
    hostnames: ["sciencedirect.com", "elsevier.com"],
  },
  {
    label: "Wiley / AGU",
    hostnames: ["wiley.com", "onlinelibrary.wiley.com", "agu.org"],
  },
  {
    label: "Science",
    hostnames: ["science.org"],
  },
  {
    label: "EGU",
    hostnames: ["copernicus.org", "egu.eu", "egusphere.net"],
  },
]);

function normalizeMimeType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function safeParseHostname(sourceUrl) {
  try {
    return new URL(sourceUrl).hostname.toLowerCase();
  } catch (error) {
    return "";
  }
}

function getArticleImageSourceRule(sourceUrl) {
  const hostname = safeParseHostname(sourceUrl);

  if (!hostname) {
    return null;
  }

  return (
    ARTICLE_IMAGE_SOURCE_RULES.find((rule) =>
      rule.hostnames.some(
        (candidateHostname) =>
          hostname === candidateHostname || hostname.endsWith(`.${candidateHostname}`)
      )
    ) || null
  );
}

function supportsArticleImagesForSourceUrl(sourceUrl) {
  return Boolean(getArticleImageSourceRule(sourceUrl));
}

function stripBackgroundImagesFromInlineStyle(styleValue) {
  return String(styleValue || "")
    .replace(/(^|;)\s*background-image\s*:[^;]+;?/gi, "$1")
    .replace(/(^|;)\s*background\s*:[^;]*url\([^)]*\)[^;]*;?/gi, "$1")
    .replace(/^\s*;\s*|\s*;\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractAssignedJsonObject(source, variableName) {
  const html = String(source || "");
  const assignmentIndex = html.indexOf(variableName);

  if (assignmentIndex === -1) {
    return "";
  }

  const startIndex = html.indexOf("{", assignmentIndex);

  if (startIndex === -1) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < html.length; index += 1) {
    const character = html[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(startIndex, index + 1);
      }
    }
  }

  return "";
}

function parsePreloadedStateFromHtml(rawHtml) {
  const jsonText = extractAssignedJsonObject(rawHtml, "window.__PRELOADED_STATE__");

  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

function getUserRole(user) {
  if (!user) {
    return "member";
  }

  if (String(user.role || "").trim()) {
    return String(user.role).trim();
  }

  return user.username === "admin" ? "admin" : "member";
}

function isAdminUser(user) {
  return getUserRole(user) === "admin";
}

function doesRecordBelongToUser(record, user) {
  if (!record || !user) {
    return false;
  }

  const recordUserId = String(record.created_by_user_id || "").trim();
  const recordUsername = String(record.created_by_username || "").trim();

  if (recordUserId && user.id) {
    return recordUserId === user.id;
  }

  return Boolean(recordUsername && recordUsername === user.username);
}

function canDeleteOwnedRecord(record, user) {
  if (!record || !user) {
    return false;
  }

  return isAdminUser(user) || doesRecordBelongToUser(record, user);
}

function isReplyAnnotation(annotation) {
  return Boolean(String(annotation?.parent_annotation_id || "").trim());
}

function getThreadRootAnnotationId(annotation) {
  return String(annotation?.root_annotation_id || annotation?.id || "").trim();
}

function isDiscussionReply(discussion) {
  return Boolean(String(discussion?.parent_discussion_id || "").trim());
}

function getThreadRootDiscussionId(discussion) {
  return String(discussion?.root_discussion_id || discussion?.id || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PaperShareShared = {
  ANNOTATION_SCOPE_LABELS,
  ARTICLE_IMAGE_SOURCE_RULES,
  ATTACHMENT_INPUT_ACCEPT,
  DEFAULT_ANNOTATION_SCOPE,
  IMAGE_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  TABLE_ATTACHMENT_EXTENSIONS,
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
};

if (typeof globalThis !== "undefined") {
  globalThis.PaperShareShared = PaperShareShared;
}

module.exports = PaperShareShared;
