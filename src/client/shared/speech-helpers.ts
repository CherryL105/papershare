import {
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
} from "../../../shared/papershare-shared";
import type {
  Annotation,
  PendingSelection,
  Discussion,
  Attachment,
  EditableAttachmentItem,
  EditState,
  ComposerState,
  Paper,
  SpeechActivityRecord,
  User,
} from "./types";

type AttachmentSource = File | Attachment | EditableAttachmentItem | null | undefined;
type AttachmentRecord = { attachments?: Attachment[] } | null | undefined;
type NoteRecord = { note?: string } | null | undefined;
type AuthorRecord = { created_by_username?: string } | null | undefined;
type MutableRecord = Paper | Annotation | Discussion | SpeechActivityRecord | null | undefined;

export {
  ANNOTATION_SCOPE_LABELS,
  ATTACHMENT_INPUT_ACCEPT,
  DEFAULT_ANNOTATION_SCOPE,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  isReplyAnnotation,
};

export function normalizeAnnotationScope(scope: string | undefined): string {
  const normalizedScope = String(scope || DEFAULT_ANNOTATION_SCOPE).trim().toLowerCase();
  return ANNOTATION_SCOPE_LABELS[normalizedScope] ? normalizedScope : DEFAULT_ANNOTATION_SCOPE;
}

export function getAnnotationScopeLabel(scope: string | undefined): string {
  return ANNOTATION_SCOPE_LABELS[normalizeAnnotationScope(scope)];
}

export function compareAnnotationsForDisplay(left: Annotation, right: Annotation): number {
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

    return Number(new Date(left.created_at || 0)) - Number(new Date(right.created_at || 0));
  }

  const scopeOrder =
    getScopeSortOrder(left.target_scope) - getScopeSortOrder(right.target_scope);

  if (scopeOrder !== 0) {
    return scopeOrder;
  }

  return Number(left.start_offset || 0) - Number(right.start_offset || 0);
}

export function compareDiscussionsForDisplay(left: Discussion, right: Discussion): number {
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

  return Number(new Date(left.created_at || 0)) - Number(new Date(right.created_at || 0));
}

export function getTopLevelAnnotations(annotations: Annotation[]): Annotation[] {
  return normalizeArray(annotations).filter((annotation) => !isReplyAnnotation(annotation));
}

export function getRepliesForAnnotation(annotations: Annotation[], annotationId: string): Annotation[] {
  return normalizeArray(annotations)
    .filter((annotation) => getThreadRootAnnotationId(annotation) === annotationId)
    .filter((annotation) => isReplyAnnotation(annotation))
    .sort((left, right) => Number(new Date(left.created_at || 0)) - Number(new Date(right.created_at || 0)));
}

export function getTopLevelDiscussions(discussions: Discussion[]): Discussion[] {
  return normalizeArray(discussions).filter((discussion) => !isDiscussionReply(discussion));
}

export function getRepliesForDiscussion(discussions: Discussion[], discussionId: string): Discussion[] {
  return normalizeArray(discussions)
    .filter((discussion) => getThreadRootDiscussionId(discussion) === discussionId)
    .filter((discussion) => isDiscussionReply(discussion))
    .sort((left, right) => Number(new Date(left.created_at || 0)) - Number(new Date(right.created_at || 0)));
}

export function getReplyTargetAnnotation(annotations: Annotation[], annotation: Annotation | null | undefined): Annotation | null {
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

export function getReplyRelationText(annotations: Annotation[], reply: Annotation): string {
  return `${getAuthorName(reply)}回复${getAuthorName(getReplyTargetAnnotation(annotations, reply))}：`;
}

export function getDiscussionReplyRelationText(discussions: Discussion[], reply: Discussion): string {
  const target =
    normalizeArray(discussions).find((item) => item.id === reply?.parent_discussion_id) ||
    normalizeArray(discussions).find((item) => item.id === getThreadRootDiscussionId(reply)) ||
    null;

  return `${getAuthorName(reply)}回复${getAuthorName(target)}：`;
}

export function canMutateRecord(record: MutableRecord, currentUser: User | null | undefined): boolean {
  return canDeleteOwnedRecord(record, currentUser);
}

export function createEmptyEditState(): EditState {
  return {
    targetId: null,
    targetType: "",
    draft: "",
    attachments: [],
    isSaving: false,
  };
}

export function createEmptyComposerState(): ComposerState {
  return {
    draft: "",
    attachments: [],
  };
}

export function createEditableAttachmentItems(attachments: Attachment[] | undefined): EditableAttachmentItem[] {
  return getAttachmentList(attachments).map((attachment) => ({
    kind: "existing",
    key: getExistingEditableAttachmentKey(attachment),
    attachment,
  }));
}

export function getEditableAttachmentItems(items: EditableAttachmentItem[]): EditableAttachmentItem[] {
  return normalizeArray(items);
}

export function mergeAttachmentFiles(existingFiles: File[], nextFiles: File[]): File[] {
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

export function removeFileByIndex<T>(files: T[], index: number): T[] {
  if (!Number.isInteger(index) || index < 0) {
    return normalizeArray(files);
  }

  return normalizeArray(files).filter((_, itemIndex) => itemIndex !== index);
}

export function validateAttachmentFiles(files: File[]): void {
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

export function validateEditableAttachmentItems(items: EditableAttachmentItem[]): void {
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
    if (!file) continue;

    if ((file.size || 0) > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `附件“${file.name || "未命名文件"}”超过 ${formatFileSize(MAX_ATTACHMENT_BYTES)} 限制。`
      );
    }

    if (!getAttachmentCategory(file)) {
      throw new Error(
        "仅支持上传图片或表格文件（PNG/JPG/GIF/WEBP/BMP/CSV/TSV/XLS/XLSX/ODS）。"
      );
    }

    totalBytes += file.size || 0;
  }

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(`附件总大小不能超过 ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)}。`);
  }
}

export function splitEditableAttachmentItems(items: EditableAttachmentItem[]): { existingAttachments: Attachment[], newFiles: File[] } {
  validateEditableAttachmentItems(items);

  return {
    existingAttachments: normalizeArray(items)
      .filter((item) => item?.kind === "existing")
      .map((item) => ({ ...item.attachment })),
    newFiles: normalizeArray(items)
      .filter((item) => item?.kind === "new")
      .map((item) => item.file)
      .filter((file): file is File => Boolean(file)),
  };
}

export function areEditableAttachmentsUnchanged(
  items: EditableAttachmentItem[],
  record: AttachmentRecord
): boolean {
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

export function appendFilesToEditableItems(items: EditableAttachmentItem[], nextFiles: File[]): EditableAttachmentItem[] {
  const existingItems = normalizeArray(items).filter((item) => item?.kind === "existing");
  const currentNewFiles = normalizeArray(items)
    .filter((item) => item?.kind === "new")
    .map((item) => item.file)
    .filter((file): file is File => Boolean(file));
  const mergedNewFiles = mergeAttachmentFiles(currentNewFiles, nextFiles);

  return [
    ...existingItems,
    ...mergedNewFiles.map((file) => ({
      kind: "new" as const,
      key: getNewEditableAttachmentKey(file),
      file,
    })),
  ];
}

export function removeEditableAttachmentByKey(items: EditableAttachmentItem[], key: string): EditableAttachmentItem[] {
  return normalizeArray(items).filter((item) => item?.key !== key);
}

export function createSpeechFormData({
  note = "",
  attachments = [],
  selection = null,
  retainedAttachments = [],
}: {
  note?: string;
  attachments?: (File | EditableAttachmentItem)[];
  selection?: PendingSelection | null;
  retainedAttachments?: Attachment[];
}): FormData {
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

  normalizeArray(attachments).forEach((item) => {
    const file = item instanceof File ? item : item.file;
    if (file instanceof File) {
      formData.append("attachments", file, file.name);
    }
  });

  return formData;
}

export function getAttachmentCategory(fileOrAttachment: AttachmentSource): string {
  const resolvedAttachment = resolveAttachmentSource(fileOrAttachment);
  const explicitCategory = String(resolvedAttachment?.category || "").trim();

  if (explicitCategory === "image" || explicitCategory === "table") {
    return explicitCategory;
  }

  const extension = getAttachmentExtension(
    resolvedAttachment?.name ||
      resolvedAttachment?.original_name ||
      resolvedAttachment?.filename ||
      ""
  );
  const mimeType = normalizeAttachmentMimeType(
    resolvedAttachment?.mime_type ||
      resolvedAttachment?.mimeType ||
      resolvedAttachment?.type ||
      ""
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

export function getAttachmentCategoryLabel(fileOrAttachment: AttachmentSource): string {
  const category = getAttachmentCategory(fileOrAttachment);
  return category === "image" ? "图片附件" : category === "table" ? "表格附件" : "附件";
}

export function buildAttachmentUrl(attachment: Attachment | null | undefined, resolveUrl: (path: string) => string): string {
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

export function getRecordNoteDisplay(record: NoteRecord): string {
  return String(record?.note || "").trim() || "（仅附件）";
}

export function formatFileSize(sizeBytes: number): string {
  const size = Number(sizeBytes) || 0;

  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${size} B`;
}

function normalizeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value.filter((item): item is T => Boolean(item)) : [];
}

function getScopeSortOrder(scope: string | undefined): number {
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

function getAuthorName(record: AuthorRecord): string {
  return record?.created_by_username || "未知用户";
}

function resolveAttachmentSource(
  fileOrAttachment: AttachmentSource
): (Attachment & { name?: string; mimeType?: string; type?: string }) | null {
  if (!fileOrAttachment) {
    return null;
  }

  if (fileOrAttachment instanceof File) {
    return fileOrAttachment as Attachment & { name?: string; mimeType?: string; type?: string };
  }

  if (isEditableAttachmentItem(fileOrAttachment)) {
    return fileOrAttachment.file || fileOrAttachment.attachment || null;
  }

  return fileOrAttachment;
}

function isEditableAttachmentItem(value: AttachmentSource): value is EditableAttachmentItem {
  return Boolean(value && typeof value === "object" && "kind" in value);
}

function getExistingEditableAttachmentKey(attachment: Attachment): string {
  return `existing:${attachment?.id || attachment?.storage_path || attachment?.url || ""}`;
}

function getNewEditableAttachmentKey(file: File): string {
  return `new:${getAttachmentFileSignature(file)}`;
}

function getAttachmentFileSignature(file: File): string {
  return [file?.name || "", file?.size || 0, file?.type || "", file?.lastModified || 0].join(
    "::"
  );
}

function normalizeAttachmentMimeType(value: string | undefined): string {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function getAttachmentExtension(filename: string): string {
  const normalizedName = String(filename || "").trim();
  const extensionIndex = normalizedName.lastIndexOf(".");
  return extensionIndex >= 0 ? normalizedName.slice(extensionIndex).toLowerCase() : "";
}

function getAttachmentList(attachments: Attachment[] | undefined): Attachment[] {
  return normalizeArray(attachments);
}
