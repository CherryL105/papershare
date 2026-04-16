import * as sharedModule from "../../../shared/papershare-shared.js";

const shared = sharedModule?.default || sharedModule;
const {
  ANNOTATION_SCOPE_LABELS,
  ATTACHMENT_INPUT_ACCEPT,
  DEFAULT_ANNOTATION_SCOPE,
  IMAGE_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  TABLE_ATTACHMENT_EXTENSIONS,
  canDeleteOwnedRecord,
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  isDiscussionReply,
  isReplyAnnotation,
} = shared;

export {
  ANNOTATION_SCOPE_LABELS,
  ATTACHMENT_INPUT_ACCEPT,
  DEFAULT_ANNOTATION_SCOPE,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
};

export function normalizeAnnotationScope(scope) {
  const normalizedScope = String(scope || DEFAULT_ANNOTATION_SCOPE).trim().toLowerCase();
  return ANNOTATION_SCOPE_LABELS[normalizedScope] ? normalizedScope : DEFAULT_ANNOTATION_SCOPE;
}

export function getAnnotationScopeLabel(scope) {
  return ANNOTATION_SCOPE_LABELS[normalizeAnnotationScope(scope)];
}

export function compareAnnotationsForDisplay(left, right) {
  const leftIsReply = isReplyAnnotation(left);
  const rightIsReply = isReplyAnnotation(right);

  if (leftIsReply !== rightIsReply) {
    return leftIsReply ? 1 : -1;
  }

  if (leftIsReply && rightIsReply) {
    const rootOrder = getThreadRootAnnotationId(left).localeCompare(
      getThreadRootAnnotationId(right)
    );

    if (rootOrder !== 0) {
      return rootOrder;
    }

    return new Date(left.created_at || 0) - new Date(right.created_at || 0);
  }

  const scopeOrder =
    getScopeSortOrder(left.target_scope) - getScopeSortOrder(right.target_scope);

  if (scopeOrder !== 0) {
    return scopeOrder;
  }

  return Number(left.start_offset || 0) - Number(right.start_offset || 0);
}

export function compareDiscussionsForDisplay(left, right) {
  const leftIsReply = isDiscussionReply(left);
  const rightIsReply = isDiscussionReply(right);

  if (leftIsReply !== rightIsReply) {
    return leftIsReply ? 1 : -1;
  }

  if (leftIsReply && rightIsReply) {
    const rootOrder = getThreadRootDiscussionId(left).localeCompare(
      getThreadRootDiscussionId(right)
    );

    if (rootOrder !== 0) {
      return rootOrder;
    }
  }

  return new Date(left.created_at || 0) - new Date(right.created_at || 0);
}

export function getTopLevelAnnotations(annotations) {
  return normalizeArray(annotations).filter((annotation) => !isReplyAnnotation(annotation));
}

export function getRepliesForAnnotation(annotations, annotationId) {
  return normalizeArray(annotations)
    .filter((annotation) => getThreadRootAnnotationId(annotation) === annotationId)
    .filter((annotation) => isReplyAnnotation(annotation))
    .sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));
}

export function getTopLevelDiscussions(discussions) {
  return normalizeArray(discussions).filter((discussion) => !isDiscussionReply(discussion));
}

export function getRepliesForDiscussion(discussions, discussionId) {
  return normalizeArray(discussions)
    .filter((discussion) => getThreadRootDiscussionId(discussion) === discussionId)
    .filter((discussion) => isDiscussionReply(discussion))
    .sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));
}

export function getReplyTargetAnnotation(annotations, annotation) {
  if (!annotation) {
    return null;
  }

  if (!isReplyAnnotation(annotation)) {
    return annotation;
  }

  return (
    normalizeArray(annotations).find((item) => item.id === annotation.parent_annotation_id) ||
    normalizeArray(annotations).find((item) => item.id === getThreadRootAnnotationId(annotation)) ||
    null
  );
}

export function getReplyRelationText(annotations, reply) {
  return `${getAuthorName(reply)}回复${getAuthorName(getReplyTargetAnnotation(annotations, reply))}：`;
}

export function getDiscussionReplyRelationText(discussions, reply) {
  const target =
    normalizeArray(discussions).find((item) => item.id === reply?.parent_discussion_id) ||
    normalizeArray(discussions).find((item) => item.id === getThreadRootDiscussionId(reply)) ||
    null;

  return `${getAuthorName(reply)}回复${getAuthorName(target)}：`;
}

export function canMutateRecord(record, currentUser) {
  return canDeleteOwnedRecord(record, currentUser);
}

export function createEmptyEditState() {
  return {
    targetId: null,
    targetType: "",
    draft: "",
    attachments: [],
    isSaving: false,
  };
}

export function createEmptyComposerState() {
  return {
    draft: "",
    attachments: [],
  };
}

export function createEditableAttachmentItems(attachments) {
  return getAttachmentList(attachments).map((attachment) => ({
    kind: "existing",
    key: getExistingEditableAttachmentKey(attachment),
    attachment,
  }));
}

export function getEditableAttachmentItems(items) {
  return normalizeArray(items);
}

export function mergeAttachmentFiles(existingFiles, nextFiles) {
  const mergedFiles = [...normalizeArray(existingFiles)];
  const seen = new Set(mergedFiles.map(getAttachmentFileSignature));

  for (const file of normalizeArray(nextFiles)) {
    const signature = getAttachmentFileSignature(file);

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    mergedFiles.push(file);
  }

  return mergedFiles;
}

export function removeFileByIndex(files, index) {
  if (!Number.isInteger(index) || index < 0) {
    return normalizeArray(files);
  }

  return normalizeArray(files).filter((_, itemIndex) => itemIndex !== index);
}

export function validateAttachmentFiles(files) {
  const normalizedFiles = normalizeArray(files);

  if (!normalizedFiles.length) {
    return;
  }

  if (normalizedFiles.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`单次最多上传 ${MAX_ATTACHMENT_COUNT} 个附件。`);
  }

  const totalBytes = normalizedFiles.reduce((sum, file) => sum + (file?.size || 0), 0);

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(`附件总大小不能超过 ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)}。`);
  }

  for (const file of normalizedFiles) {
    if ((file?.size || 0) > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `附件“${file?.name || "未命名文件"}”超过 ${formatFileSize(MAX_ATTACHMENT_BYTES)} 限制。`
      );
    }

    if (!getAttachmentCategory(file)) {
      throw new Error(
        "仅支持上传图片或表格文件（PNG/JPG/GIF/WEBP/BMP/CSV/TSV/XLS/XLSX/ODS）。"
      );
    }
  }
}

export function validateEditableAttachmentItems(items) {
  const normalizedItems = normalizeArray(items);

  if (!normalizedItems.length) {
    return;
  }

  if (normalizedItems.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`单次最多上传 ${MAX_ATTACHMENT_COUNT} 个附件。`);
  }

  let totalBytes = 0;

  for (const item of normalizedItems) {
    if (item?.kind === "existing") {
      totalBytes += Number(item?.attachment?.size_bytes || 0);
      continue;
    }

    const file = item?.file;

    if ((file?.size || 0) > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `附件“${file?.name || "未命名文件"}”超过 ${formatFileSize(MAX_ATTACHMENT_BYTES)} 限制。`
      );
    }

    if (!getAttachmentCategory(file)) {
      throw new Error(
        "仅支持上传图片或表格文件（PNG/JPG/GIF/WEBP/BMP/CSV/TSV/XLS/XLSX/ODS）。"
      );
    }

    totalBytes += file?.size || 0;
  }

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(`附件总大小不能超过 ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)}。`);
  }
}

export function splitEditableAttachmentItems(items) {
  validateEditableAttachmentItems(items);

  return {
    existingAttachments: normalizeArray(items)
      .filter((item) => item?.kind === "existing")
      .map((item) => ({ ...item.attachment })),
    newFiles: normalizeArray(items)
      .filter((item) => item?.kind === "new")
      .map((item) => item.file)
      .filter(Boolean),
  };
}

export function areEditableAttachmentsUnchanged(items, record) {
  const currentAttachments = getAttachmentList(record?.attachments);
  const editableItems = normalizeArray(items);

  if (editableItems.length !== currentAttachments.length) {
    return false;
  }

  return editableItems.every((item, index) => {
    if (item?.kind !== "existing") {
      return false;
    }

    return (
      String(item?.attachment?.storage_path || "") ===
      String(currentAttachments[index]?.storage_path || "")
    );
  });
}

export function appendFilesToEditableItems(items, nextFiles) {
  const existingItems = normalizeArray(items).filter((item) => item?.kind === "existing");
  const currentNewFiles = normalizeArray(items)
    .filter((item) => item?.kind === "new")
    .map((item) => item.file)
    .filter(Boolean);
  const mergedNewFiles = mergeAttachmentFiles(currentNewFiles, nextFiles);

  return [
    ...existingItems,
    ...mergedNewFiles.map((file) => ({
      kind: "new",
      key: getNewEditableAttachmentKey(file),
      file,
    })),
  ];
}

export function removeEditableAttachmentByKey(items, key) {
  return normalizeArray(items).filter((item) => item?.key !== key);
}

export function createSpeechFormData({
  note = "",
  attachments = [],
  selection = null,
  retainedAttachments = [],
}) {
  const formData = new FormData();

  formData.append("note", String(note || ""));

  if (selection && typeof selection === "object") {
    Object.entries(selection).forEach(([key, value]) => {
      formData.append(key, value == null ? "" : String(value));
    });
  }

  if (Array.isArray(retainedAttachments) && retainedAttachments.length) {
    formData.append("retainedAttachments", JSON.stringify(retainedAttachments));
  }

  normalizeArray(attachments).forEach((file) => {
    if (file instanceof File) {
      formData.append("attachments", file, file.name);
    }
  });

  return formData;
}

export function getAttachmentCategory(fileOrAttachment) {
  const explicitCategory = String(fileOrAttachment?.category || "").trim();

  if (explicitCategory === "image" || explicitCategory === "table") {
    return explicitCategory;
  }

  const extension = getAttachmentExtension(
    fileOrAttachment?.name || fileOrAttachment?.original_name || fileOrAttachment?.filename || ""
  );
  const mimeType = normalizeAttachmentMimeType(
    fileOrAttachment?.mime_type || fileOrAttachment?.mimeType || fileOrAttachment?.type || ""
  );

  if (IMAGE_ATTACHMENT_EXTENSIONS.has(extension) || mimeType.startsWith("image/")) {
    return "image";
  }

  if (
    TABLE_ATTACHMENT_EXTENSIONS.has(extension) ||
    [
      "text/csv",
      "text/tab-separated-values",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.spreadsheet",
    ].includes(mimeType)
  ) {
    return "table";
  }

  return "";
}

export function getAttachmentCategoryLabel(fileOrAttachment) {
  const category = getAttachmentCategory(fileOrAttachment);
  return category === "image" ? "图片附件" : category === "table" ? "表格附件" : "附件";
}

export function buildAttachmentUrl(attachment, resolveUrl) {
  const rawUrl = String(attachment?.url || attachment?.storage_path || "").trim();

  if (!rawUrl) {
    return "#";
  }

  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const normalizedPath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
  return typeof resolveUrl === "function" ? resolveUrl(normalizedPath) : normalizedPath;
}

export function getRecordNoteDisplay(record) {
  return String(record?.note || "").trim() || "（仅附件）";
}

export function formatFileSize(sizeBytes) {
  const size = Number(sizeBytes) || 0;

  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${size} B`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function getScopeSortOrder(scope) {
  switch (normalizeAnnotationScope(scope)) {
    case "body":
      return 4;
    case "abstract":
      return 3;
    case "authors":
      return 2;
    case "title":
      return 1;
    default:
      return 0;
  }
}

function getAuthorName(record) {
  return record?.created_by_username || "未知用户";
}

function getExistingEditableAttachmentKey(attachment) {
  return `existing:${attachment?.id || attachment?.storage_path || attachment?.url || ""}`;
}

function getNewEditableAttachmentKey(file) {
  return `new:${getAttachmentFileSignature(file)}`;
}

function getAttachmentFileSignature(file) {
  return [file?.name || "", file?.size || 0, file?.type || "", file?.lastModified || 0].join(
    "::"
  );
}

function normalizeAttachmentMimeType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function getAttachmentExtension(filename) {
  const normalizedName = String(filename || "").trim();
  const extensionIndex = normalizedName.lastIndexOf(".");
  return extensionIndex >= 0 ? normalizedName.slice(extensionIndex).toLowerCase() : "";
}

function getAttachmentList(attachments) {
  return normalizeArray(attachments);
}
