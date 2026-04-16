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

function splitPeople(value) {
  return String(value || "")
    .split(/[\n,，;；|]/)
    .map(cleanTextValue)
    .filter(Boolean);
}

function normalizeKeywords(value) {
  return [...new Set(String(value || "").split(/[\n,，;；|]/).map(cleanTextValue))].filter(
    Boolean
  );
}

function firstNonEmpty(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  cleanTextValue,
  decodeHtmlEntities,
  escapeRegExp,
  firstNonEmpty,
  normalizeKeywords,
  splitPeople,
  stripTags,
};
