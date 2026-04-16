const path = require("path");
const {
  normalizeMimeType,
  supportsArticleImagesForSourceUrl,
} = require("../../../shared/papershare-shared");
const {
  inferMimeTypeFromPath,
  resolveAttachmentCategory,
  sanitizeAttachmentName,
} = require("./attachment-utils");
const { EXTENSION_BY_MIME_TYPE } = require("./mime-types");
const { cleanTextValue, normalizeKeywords } = require("./text-utils");

function createRecordNormalizers({ buildPrivateStorageUrl, normalizeStorageRecordPath }) {
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

  function normalizeAttachmentRecords(attachments) {
    if (!Array.isArray(attachments)) {
      return [];
    }

    return attachments
      .map(normalizeAttachmentRecord)
      .filter((attachment) => attachment.storage_path && attachment.category);
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

  return {
    normalizeAnnotationRecord,
    normalizeAttachmentRecord,
    normalizeAttachmentRecords,
    normalizeDiscussionRecord,
    normalizePaperRecord,
  };
}

module.exports = {
  createRecordNormalizers,
};
