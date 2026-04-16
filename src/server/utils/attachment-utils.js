const path = require("path");
const {
  normalizeMimeType,
  IMAGE_ATTACHMENT_EXTENSIONS,
  TABLE_ATTACHMENT_EXTENSIONS,
} = require("../../../shared/papershare-shared");
const { EXTENSION_BY_MIME_TYPE, MIME_TYPE_BY_EXTENSION } = require("./mime-types");

function sanitizeAttachmentName(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  return path.basename(trimmed).replace(/[^\w.\-()\u4e00-\u9fa5 ]+/g, "_").slice(0, 120);
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

module.exports = {
  formatLimitInMb,
  inferMimeTypeFromPath,
  resolveAttachmentCategory,
  resolveAttachmentDescriptor,
  sanitizeAttachmentName,
};
