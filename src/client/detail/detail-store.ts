import {
  canDeleteOwnedRecord,
  doesRecordBelongToUser,
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  isDiscussionReply,
  isReplyAnnotation,
} from "../../../shared/papershare-shared";
import { refreshPapers } from "../catalog/catalog-store";
import {
  createInitialDetailState,
  getClientState,
  isDetailPage,
  navigateToClientUrl,
  resolveDetailFocusState,
  updateClientState,
} from "../shared/client-store";
import {
  apiRequest,
  buildApiUrl,
  buildPaperDetailUrl,
  initializeSession,
} from "../shared/session-store";
import {
  appendFilesToEditableItems,
  areEditableAttachmentsUnchanged,
  compareAnnotationsForDisplay,
  compareDiscussionsForDisplay,
  createEditableAttachmentItems,
  createEmptyComposerState,
  createEmptyEditState,
  createSpeechFormData,
  mergeAttachmentFiles,
  removeEditableAttachmentByKey,
  removeFileByIndex,
  splitEditableAttachmentItems,
  validateAttachmentFiles,
  validateEditableAttachmentItems,
} from "../shared/speech-helpers";
import {
  extractReadableArticleHtml,
  hasSelectionOverlap,
  readPaperIdFromHash,
  readPaperRouteFromQuery,
  supportsArticleImages,
  writePaperIdToHash,
} from "./detail-helpers";
import type {
  Annotation,
  AuthSessionState,
  ComposerState,
  DetailComposerKey,
  DetailComposerKind,
  DetailEditKind,
  DetailEditStateKey,
  DetailEditTargetType,
  DetailLibraryPanel,
  DetailState,
  Discussion,
  EditState,
  Paper,
  PaperContentResponse,
  PendingSelection,
} from "../shared/types";

const DETAIL_COMPOSER_KEYS = {
  annotation: "annotationComposer",
  discussion: "discussionComposer",
  discussionReply: "discussionReplyComposer",
  reply: "replyComposer",
} as const satisfies Record<DetailComposerKind, DetailComposerKey>;

const DETAIL_EDIT_KEYS = {
  annotation: "annotationEditState",
  discussion: "discussionEditState",
} as const satisfies Record<DetailEditKind, DetailEditStateKey>;

interface SelectPaperOptions {
  panel?: DetailLibraryPanel;
  updateHash?: boolean;
  focusAnnotationId?: string;
  focusReplyId?: string;
  focusDiscussionId?: string;
  focusDiscussionReplyId?: string;
}

interface SpeechConfig {
  apiBasePath: string;
  label: string;
  sortRecords: (left: Annotation | Discussion, right: Annotation | Discussion) => number;
  threadRootId: (record: Annotation | Discussion) => string;
}

const ANNOTATION_SPEECH_CONFIG: SpeechConfig = {
  apiBasePath: "/api/annotations",
  label: "批注",
  sortRecords: (left, right) =>
    compareAnnotationsForDisplay(left as Annotation, right as Annotation),
  threadRootId: (record) => getThreadRootAnnotationId(record as Annotation),
};

const DISCUSSION_SPEECH_CONFIG: SpeechConfig = {
  apiBasePath: "/api/discussions",
  label: "讨论" as const,
  sortRecords: (left, right) =>
    compareDiscussionsForDisplay(left as Discussion, right as Discussion),
  threadRootId: (record) => getThreadRootDiscussionId(record as Discussion),
};

export async function initializeDetailPage(
  options: { skipSessionInit?: boolean } = {}
): Promise<AuthSessionState> {
  updateClientState({
    detail: {
      ...getClientState().detail,
      isInitializing: true,
    },
  });

  try {
    const state = getClientState();
    const authState = options.skipSessionInit
      ? {
          authenticated: Boolean(state.auth.currentUser),
          user: state.auth.currentUser,
        }
      : await initializeSession();

    if (!authState.authenticated || !authState.user) {
      updateClientState({
        detail: createInitialDetailState(),
      });
      return authState;
    }

    if (authState.user.mustChangePassword) {
      return authState;
    }

    await apiRequest("/api/status");
    updateClientState({
      auth: {
        ...getClientState().auth,
        serverReady: true,
        databaseStatus: "服务已连接",
      },
    });

    const papers = await refreshPapers();
    await syncDetailRouteFromLocation({ papers, forceReload: true });

    return authState;
  } finally {
    updateClientState({
      detail: {
        ...getClientState().detail,
        isInitializing: false,
      },
    });
  }
}

export async function syncDetailRouteFromLocation(options: { papers?: Paper[], forceReload?: boolean } = {}): Promise<Paper | null> {
  if (!getClientState().auth.currentUser) {
    return null;
  }

  const papers = Array.isArray(options.papers) ? options.papers : getClientState().papers.items;
  const route = readPaperRouteFromQuery();
  const hashPaperId = readPaperIdFromHash();
  const requestedPaperId = route.paperId || hashPaperId;
  const preferredPaperId = papers.some((paper) => paper.id === requestedPaperId) ? requestedPaperId : "";
  const fallbackPaperId = preferredPaperId || papers[0]?.id || "";
  const nextPanel = route.panel === "discussion" ? "discussion" : "reader";

  if (!fallbackPaperId) {
    updateClientState({
      detail: {
        ...createInitialDetailState(),
        libraryPanel: nextPanel,
      },
    });
    return null;
  }

  if (options.forceReload || getClientState().detail.selectedPaperId !== fallbackPaperId) {
    return selectPaper(fallbackPaperId, {
      panel: nextPanel,
      updateHash: false,
      focusAnnotationId: route.annotationId,
      focusReplyId: route.replyId,
      focusDiscussionId: route.discussionId,
      focusDiscussionReplyId: route.discussionReplyId,
    });
  }

  updateClientState({
    detail: {
      ...getClientState().detail,
      libraryPanel: nextPanel,
      ...resolveDetailFocusState(getClientState().detail.annotations, getClientState().detail.discussions, {
        focusAnnotationId: route.annotationId,
        focusReplyId: route.replyId,
        focusDiscussionId: route.discussionId,
        focusDiscussionReplyId: route.discussionReplyId,
      }),
    },
  });

  return getClientState().detail.selectedPaper;
}

export async function handleDetailHashChange(): Promise<Paper | null> {
  if (!getClientState().auth.currentUser) {
    return null;
  }

  const paperId = readPaperIdFromHash();

  if (!paperId || paperId === getClientState().detail.selectedPaperId) {
    return null;
  }

  if (!getClientState().papers.items.some((paper) => paper.id === paperId)) {
    return null;
  }

  return selectPaper(paperId, { updateHash: false });
}

export async function selectPaper(
  paperId: string,
  options: SelectPaperOptions = {}
): Promise<Paper | null> {
  if (!getClientState().auth.currentUser) {
    return null;
  }

  const paper = getClientState().papers.items.find((item) => item.id === paperId);

  if (!paper) {
    return null;
  }

  const panel: DetailLibraryPanel =
    options.panel === "discussion" ? "discussion" : getClientState().detail.libraryPanel;

  updateClientState({
    detail: {
      ...createInitialDetailState(),
      libraryPanel: panel,
      selectedPaperId: paper.id,
      selectedPaper: paper,
    },
  });

  const shouldPrefetchContent = Boolean(paper.hasSnapshot || paper.snapshotPath);
  const contentPromise = shouldPrefetchContent
    ? apiRequest<PaperContentResponse>(`/api/papers/${encodeURIComponent(paper.id)}/content`)
        .then((content) => ({ content, error: null }))
        .catch((error) => ({ content: null, error }))
    : Promise.resolve({ content: null, error: null });
  const [paperDetail, annotations, discussions, prefetchedContentResult] = await Promise.all([
    apiRequest<Paper>(`/api/papers/${encodeURIComponent(paper.id)}`),
    apiRequest<Annotation[]>(`/api/papers/${encodeURIComponent(paper.id)}/annotations`),
    apiRequest<Discussion[]>(`/api/papers/${encodeURIComponent(paper.id)}/discussions`),
    contentPromise,
  ]);

  let articleHtml = "";

  if (paperDetail.hasSnapshot || paperDetail.snapshotPath) {
    if (prefetchedContentResult.error) {
      throw prefetchedContentResult.error;
    }

    const content =
      prefetchedContentResult.content ||
      (await apiRequest<PaperContentResponse>(`/api/papers/${encodeURIComponent(paper.id)}/content`));
    articleHtml = extractReadableArticleHtml(content.rawHtml, paperDetail.sourceUrl || "", {
      allowImages: supportsArticleImages(paperDetail),
      buildApiUrl,
    });
  }

  const sortedAnnotations = [...annotations].sort(compareAnnotationsForDisplay);
  const sortedDiscussions = [...discussions].sort(compareDiscussionsForDisplay);
  const focusState = resolveDetailFocusState(sortedAnnotations, sortedDiscussions, options);

  updateClientState({
    detail: {
      ...getClientState().detail,
      libraryPanel: panel,
      selectedPaperId: paper.id,
      selectedPaper: paperDetail,
      articleHtml,
      articleLoaded: true,
      annotations: sortedAnnotations,
      discussions: sortedDiscussions,
      ...focusState,
    },
  });

  if (options.updateHash !== false) {
    writePaperIdToHash(paper.id);
  }

  return paperDetail;
}

export async function refreshSelectedPaperAnnotations(): Promise<Annotation[]> {
  if (!getClientState().auth.currentUser || !getClientState().detail.selectedPaperId) {
    updateClientState({
      detail: {
        ...getClientState().detail,
        annotations: [],
        selectedAnnotationId: null,
        selectedReplyId: null,
        annotationNavigationTargetId: null,
      },
    });
    return [];
  }

  const annotations = await apiRequest<Annotation[]>(
    `/api/papers/${encodeURIComponent(getClientState().detail.selectedPaperId)}/annotations`
  );
  const sortedAnnotations = [...annotations].sort(compareAnnotationsForDisplay);
  const topLevelAnnotationIds = new Set(
    sortedAnnotations.filter((item) => !isReplyAnnotation(item)).map((item) => item.id)
  );
  const annotationIds = new Set(sortedAnnotations.map((item) => item.id));

  updateClientState({
    detail: {
      ...getClientState().detail,
      annotations: sortedAnnotations,
      selectedAnnotationId: getClientState().detail.selectedAnnotationId && topLevelAnnotationIds.has(getClientState().detail.selectedAnnotationId as string)
        ? getClientState().detail.selectedAnnotationId
        : null,
      selectedReplyId: getClientState().detail.selectedReplyId && annotationIds.has(getClientState().detail.selectedReplyId as string)
        ? getClientState().detail.selectedReplyId
        : null,
    },
  });

  return sortedAnnotations;
}

export async function refreshSelectedPaperDiscussions(): Promise<Discussion[]> {
  if (!getClientState().auth.currentUser || !getClientState().detail.selectedPaperId) {
    updateClientState({
      detail: {
        ...getClientState().detail,
        discussions: [],
        selectedDiscussionId: null,
        selectedDiscussionReplyId: null,
        discussionNavigationTargetId: null,
      },
    });
    return [];
  }

  const discussions = await apiRequest<Discussion[]>(
    `/api/papers/${encodeURIComponent(getClientState().detail.selectedPaperId)}/discussions`
  );
  const sortedDiscussions = [...discussions].sort(compareDiscussionsForDisplay);
  const topLevelDiscussionIds = new Set(
    sortedDiscussions.filter((item) => !isDiscussionReply(item)).map((item) => item.id)
  );
  const discussionIds = new Set(sortedDiscussions.map((item) => item.id));

  updateClientState({
    detail: {
      ...getClientState().detail,
      discussions: sortedDiscussions,
      selectedDiscussionId: getClientState().detail.selectedDiscussionId && topLevelDiscussionIds.has(getClientState().detail.selectedDiscussionId as string)
        ? getClientState().detail.selectedDiscussionId
        : null,
      selectedDiscussionReplyId: getClientState().detail.selectedDiscussionReplyId && discussionIds.has(getClientState().detail.selectedDiscussionReplyId as string)
        ? getClientState().detail.selectedDiscussionReplyId
        : null,
    },
  });

  return sortedDiscussions;
}

export function clearSelectedDetailPaper(): void {
  writePaperIdToHash("");
  updateClientState({
    detail: {
      ...createInitialDetailState(),
      libraryPanel: getClientState().detail.libraryPanel,
    },
  });
}

export function setLibraryPanel(panelName: string): void {
  const nextPanel = panelName === "discussion" ? "discussion" : "reader";

  updateClientState({
    detail: {
      ...getClientState().detail,
      libraryPanel: nextPanel,
      pendingSelection: nextPanel === "discussion" ? null : getClientState().detail.pendingSelection,
    },
  });
}

export function setPendingSelection(selection: PendingSelection | null): void {
  updateClientState({
    detail: {
      ...getClientState().detail,
      pendingSelection: selection || null,
    },
  });
}

export function clearPendingSelection(): void {
  updateClientState({
    detail: {
      ...getClientState().detail,
      pendingSelection: null,
    },
  });
}

export function setDetailComposerDraft(kind: DetailComposerKind, draft: string): void {
  updateComposerState(kind, (composer) => ({
    ...composer,
    draft: String(draft || ""),
  }));
}

export function addDetailComposerAttachments(kind: DetailComposerKind, nextFiles: File[]): void {
  const mergedFiles = mergeAttachmentFiles(getComposerState(kind).attachments, nextFiles);
  validateAttachmentFiles(mergedFiles);

  updateComposerState(kind, (composer) => ({
    ...composer,
    attachments: mergedFiles,
  }));
}

export function removeDetailComposerAttachment(kind: DetailComposerKind, index: number): void {
  updateComposerState(kind, (composer) => ({
    ...composer,
    attachments: removeFileByIndex(composer.attachments, index),
  }));
}

export function clearDetailComposerAttachments(kind: DetailComposerKind): void {
  updateComposerState(kind, (composer) => ({
    ...composer,
    attachments: [],
  }));
}

export async function saveAnnotation(): Promise<Annotation | null> {
  const state = getClientState();
  const currentUser = state.auth.currentUser;
  const paper = state.detail.selectedPaper;
  const composer = state.detail.annotationComposer;
  const pendingSelection = state.detail.pendingSelection;

  if (!currentUser || !paper || !pendingSelection) {
    return null;
  }

  const note = String(composer.draft || "").trim();
  const files = composer.attachments;
  validateAttachmentFiles(files);

  if (!note && files.length === 0) {
    throw new Error("请先填写批注内容或选择附件。");
  }

  if (hasSelectionOverlap(getClientState().detail.annotations, pendingSelection)) {
    throw new Error("当前版本暂不支持重叠批注，请换一段未高亮的文本再试。");
  }

  updateClientState({
    detail: {
      ...getClientState().detail,
      isSavingAnnotation: true,
    },
  });

  try {
    const formData = createSpeechFormData({
      note,
      attachments: files,
      selection: pendingSelection,
    });
    const annotation = await apiRequest<Annotation>(
      `/api/papers/${encodeURIComponent(paper.id)}/annotations`,
      {
        method: "POST",
        body: formData,
      }
    );
    const nextAnnotations = [...getClientState().detail.annotations, annotation].sort(
      compareAnnotationsForDisplay
    );

    updateClientState({
      detail: {
        ...getClientState().detail,
        annotations: nextAnnotations,
        selectedAnnotationId: annotation.id,
        selectedReplyId: null,
        annotationNavigationTargetId: annotation.id,
        pendingSelection: null,
        annotationComposer: createEmptyComposerState(),
      },
    });

    return annotation;
  } finally {
    updateClientState({
      detail: {
        ...getClientState().detail,
        isSavingAnnotation: false,
      },
    });
  }
}

export async function saveDiscussion(): Promise<Discussion | null> {
  const state = getClientState();
  const currentUser = state.auth.currentUser;
  const paper = state.detail.selectedPaper;
  const composer = state.detail.discussionComposer;

  if (!currentUser || !paper) {
    return null;
  }

  const note = String(composer.draft || "").trim();
  const files = composer.attachments;
  validateAttachmentFiles(files);

  if (!note && files.length === 0) {
    throw new Error("请先填写讨论内容或选择附件。");
  }

  updateClientState({
    detail: {
      ...getClientState().detail,
      isSavingDiscussion: true,
    },
  });

  try {
    const formData = createSpeechFormData({ note, attachments: files });
    const discussion = await apiRequest<Discussion>(
      `/api/papers/${encodeURIComponent(paper.id)}/discussions`,
      {
        method: "POST",
        body: formData,
      }
    );
    const nextDiscussions = [...getClientState().detail.discussions, discussion].sort(
      compareDiscussionsForDisplay
    );

    updateClientState({
      detail: {
        ...getClientState().detail,
        discussions: nextDiscussions,
        selectedDiscussionId: discussion.id,
        selectedDiscussionReplyId: null,
        discussionNavigationTargetId: discussion.id,
        discussionComposer: createEmptyComposerState(),
      },
    });

    return discussion;
  } finally {
    updateClientState({
      detail: {
        ...getClientState().detail,
        isSavingDiscussion: false,
      },
    });
  }
}

export async function saveAnnotationReply(): Promise<Annotation | null> {
  return saveSpeechReply("annotation") as Promise<Annotation | null>;
}

export async function saveDiscussionReply(): Promise<Discussion | null> {
  return saveSpeechReply("discussion") as Promise<Discussion | null>;
}

export function selectAnnotationThread(annotationId: string | null): void {
  updateClientState({
    detail: {
      ...getClientState().detail,
      selectedAnnotationId: annotationId || null,
      selectedReplyId: null,
      annotationNavigationTargetId: annotationId || null,
      annotationEditState: createEmptyEditState(),
    },
  });
}

export function selectDiscussionThread(discussionId: string | null): void {
  updateClientState({
    detail: {
      ...getClientState().detail,
      selectedDiscussionId: discussionId || null,
      selectedDiscussionReplyId: null,
      discussionNavigationTargetId: discussionId || null,
      discussionEditState: createEmptyEditState(),
    },
  });
}

export function selectAnnotationReply(replyId: string | null): void {
  const reply =
    getClientState().detail.annotations.find((annotation) => annotation.id === replyId) || null;

  updateClientState({
    detail: {
      ...getClientState().detail,
      selectedAnnotationId: reply ? getThreadRootAnnotationId(reply) : getClientState().detail.selectedAnnotationId,
      selectedReplyId: replyId || null,
      annotationNavigationTargetId: reply ? getThreadRootAnnotationId(reply) : null,
      annotationEditState: createEmptyEditState(),
    },
  });
}

export function selectDiscussionReply(replyId: string | null): void {
  const reply =
    getClientState().detail.discussions.find((discussion) => discussion.id === replyId) || null;

  updateClientState({
    detail: {
      ...getClientState().detail,
      selectedDiscussionId: reply
        ? getThreadRootDiscussionId(reply)
        : getClientState().detail.selectedDiscussionId,
      selectedDiscussionReplyId: replyId || null,
      discussionNavigationTargetId: reply ? getThreadRootDiscussionId(reply) : null,
      discussionEditState: createEmptyEditState(),
    },
  });
}

export async function deleteSelectedAnnotation(): Promise<Annotation | null> {
  return deleteSelectedSpeech("annotation") as Promise<Annotation | null>;
}

export async function deleteSelectedDiscussion(): Promise<Discussion | null> {
  return deleteSelectedSpeech("discussion") as Promise<Discussion | null>;
}

export async function deleteAnnotationReply(replyId: string): Promise<Annotation | null> {
  return deleteSpeechReply("annotation", replyId) as Promise<Annotation | null>;
}

export async function deleteDiscussionReply(replyId: string): Promise<Discussion | null> {
  return deleteSpeechReply("discussion", replyId) as Promise<Discussion | null>;
}

export async function clearSelectedPaperAnnotations(): Promise<{ ok: boolean, deletedCount: number }> {
  const state = getClientState();
  const currentUser = state.auth.currentUser;
  const paper = state.detail.selectedPaper;

  if (!currentUser || !paper) {
    return { ok: false, deletedCount: 0 };
  }

  await apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/annotations`, {
    method: "DELETE",
  });

  const ownAnnotationIds = new Set(
    getClientState().detail.annotations
      .filter((annotation) => doesRecordBelongToUser(annotation, currentUser))
      .map((annotation) => annotation.id)
  );
  const nextAnnotations = getClientState().detail.annotations.filter((annotation) => {
    const threadRootId = getThreadRootAnnotationId(annotation);
    return !ownAnnotationIds.has(annotation.id) && !ownAnnotationIds.has(threadRootId);
  });

  updateClientState({
    detail: {
      ...getClientState().detail,
      annotations: nextAnnotations,
      pendingSelection: null,
      selectedAnnotationId: getClientState().detail.selectedAnnotationId && ownAnnotationIds.has(getClientState().detail.selectedAnnotationId as string)
        ? null
        : getClientState().detail.selectedAnnotationId,
      selectedReplyId: getClientState().detail.selectedReplyId && ownAnnotationIds.has(getClientState().detail.selectedReplyId as string)
        ? null
        : getClientState().detail.selectedReplyId,
      annotationNavigationTargetId: null,
      annotationComposer: createEmptyComposerState(),
      replyComposer: createEmptyComposerState(),
      annotationEditState: createEmptyEditState(),
    },
  });

  return { ok: true, deletedCount: ownAnnotationIds.size };
}

export async function deleteSelectedPaper(): Promise<Paper | null> {
  const state = getClientState();
  const paper = state.detail.selectedPaper;
  const currentUser = state.auth.currentUser;

  if (!paper || !currentUser) {
    return null;
  }

  if (!canDeleteOwnedRecord(paper, currentUser)) {
    throw new Error("无权删除该文献");
  }

  await apiRequest(`/api/papers/${encodeURIComponent(paper.id)}`, {
    method: "DELETE",
  });

  const deletedPaperId = paper.id;
  const papers = await refreshPapers();
  const nextPaperId = papers.find((item) => item.id !== deletedPaperId)?.id || "";

  if (nextPaperId) {
    return selectPaper(nextPaperId, {
      panel: getClientState().detail.libraryPanel,
      updateHash: true,
    });
  }

  clearSelectedDetailPaper();
  return null;
}

export function startDetailEdit(
  kind: DetailEditKind,
  recordId: string,
  targetType: DetailEditTargetType = kind
): void {
  const records = getSpeechRecords(kind);
  const record = records.find((item) => item.id === recordId) || null;

  if (!record) {
    return;
  }

  const nextEditState: EditState = {
    targetId: record.id,
    targetType,
    draft: record.note || "",
    attachments: createEditableAttachmentItems(record.attachments),
    isSaving: false,
  };

  const detail = getClientState().detail;

  updateClientState({
    detail: {
      ...detail,
      ...(kind === "discussion"
        ? {
            discussionEditState: nextEditState,
            ...(targetType === "reply" ? { selectedDiscussionReplyId: record.id } : {}),
          }
        : {
            annotationEditState: nextEditState,
            ...(targetType === "reply" ? { selectedReplyId: record.id } : {}),
          }),
    },
  });
}

export function cancelDetailEdit(kind: DetailEditKind): void {
  updateEditState(kind, () => createEmptyEditState());
}

export function setDetailEditDraft(kind: DetailEditKind, draft: string): void {
  updateEditState(kind, (editState) => ({
    ...editState,
    draft: String(draft || ""),
  }));
}

export function addDetailEditAttachments(kind: DetailEditKind, nextFiles: File[]): void {
  const nextItems = appendFilesToEditableItems(getEditState(kind).attachments, nextFiles);
  validateEditableAttachmentItems(nextItems);

  updateEditState(kind, (editState) => ({
    ...editState,
    attachments: nextItems,
  }));
}

export function clearDetailEditAttachments(kind: DetailEditKind): void {
  updateEditState(kind, (editState) => ({
    ...editState,
    attachments: [],
  }));
}

export function removeDetailEditAttachment(kind: DetailEditKind, key: string): void {
  updateEditState(kind, (editState) => ({
    ...editState,
    attachments: removeEditableAttachmentByKey(editState.attachments, key),
  }));
}

export async function saveDetailEdit(kind: "annotation"): Promise<Annotation | null>;
export async function saveDetailEdit(kind: "discussion"): Promise<Discussion | null>;
export async function saveDetailEdit(
  kind: DetailEditKind
): Promise<Annotation | Discussion | null> {
  const config = resolveSpeechConfig(kind);
  const editState = getEditState(kind);
  const records = getSpeechRecords(kind);
  const record = records.find((item) => item.id === editState.targetId) || null;

  if (!record || editState.isSaving) {
    return null;
  }

  const nextNote = String(editState.draft || "").trim();
  const nextAttachments = editState.attachments;

  validateEditableAttachmentItems(nextAttachments);

  if (!nextNote && nextAttachments.length === 0) {
    throw new Error(
      editState.targetType === "reply"
        ? "请至少保留回复内容或一个附件。"
        : `请至少保留${config.label}内容或一个附件。`
    );
  }

  if (nextNote === record.note && areEditableAttachmentsUnchanged(nextAttachments, record)) {
    cancelDetailEdit(kind);
    return record;
  }

  updateEditState(kind, (currentState) => ({
    ...currentState,
    isSaving: true,
  }));

  try {
    const attachments = splitEditableAttachmentItems(nextAttachments);
    const formData = createSpeechFormData({
      note: nextNote,
      attachments: attachments.newFiles,
      retainedAttachments: attachments.existingAttachments,
    });

    if (kind === "discussion") {
      const updated = await apiRequest<Discussion>(
        `${config.apiBasePath}/${encodeURIComponent(record.id)}`,
        {
          method: "PATCH",
          body: formData,
        }
      );
      const nextRecords = getClientState().detail.discussions
        .map((item) => (item.id === updated.id ? updated : item))
        .sort(config.sortRecords);

      updateClientState({
        detail: {
          ...getClientState().detail,
          discussions: nextRecords,
          discussionEditState: createEmptyEditState(),
          ...(editState.targetType === "reply"
            ? { selectedDiscussionReplyId: updated.id }
            : {}),
        },
      });

      return updated;
    }

    const updated = await apiRequest<Annotation>(
      `${config.apiBasePath}/${encodeURIComponent(record.id)}`,
      {
        method: "PATCH",
        body: formData,
      }
    );
    const nextRecords = getClientState().detail.annotations
      .map((item) => (item.id === updated.id ? updated : item))
      .sort(config.sortRecords);

    updateClientState({
      detail: {
        ...getClientState().detail,
        annotations: nextRecords,
        annotationEditState: createEmptyEditState(),
        ...(editState.targetType === "reply" ? { selectedReplyId: updated.id } : {}),
      },
    });

    return updated;
  } finally {
    if (getEditState(kind).targetId) {
      updateEditState(kind, (currentState) => ({
        ...currentState,
        isSaving: false,
      }));
    }
  }
}

export async function openAnnotationLocation(paperId: string, annotationId: string, options: { focusReplyId?: string } = {}): Promise<void> {
  const focusReplyId = String(options.focusReplyId || "").trim();

  if (!isDetailPage()) {
    navigateToClientUrl(
      buildPaperDetailUrl({
        paperId,
        panel: "reader",
        annotationId,
        replyId: focusReplyId,
      })
    );
    return;
  }

  setLibraryPanel("reader");

  if (getClientState().detail.selectedPaperId !== paperId) {
    await selectPaper(paperId, {
      panel: "reader",
      focusAnnotationId: annotationId,
      focusReplyId,
    });
    return;
  }

  updateClientState({
    detail: {
      ...getClientState().detail,
      selectedAnnotationId: annotationId || null,
      selectedReplyId: focusReplyId || null,
      annotationNavigationTargetId: annotationId || null,
    },
  });
}

export async function openDiscussionLocation(paperId: string, discussionId: string, options: { focusReplyId?: string } = {}): Promise<void> {
  const focusReplyId = String(options.focusReplyId || "").trim();

  if (!isDetailPage()) {
    navigateToClientUrl(
      buildPaperDetailUrl({
        paperId,
        panel: "discussion",
        discussionId,
        discussionReplyId: focusReplyId,
      })
    );
    return;
  }

  setLibraryPanel("discussion");

  if (getClientState().detail.selectedPaperId !== paperId) {
    await selectPaper(paperId, {
      panel: "discussion",
      focusDiscussionId: discussionId,
      focusDiscussionReplyId: focusReplyId,
    });
    return;
  }

  updateClientState({
    detail: {
      ...getClientState().detail,
      selectedDiscussionId: discussionId || null,
      selectedDiscussionReplyId: focusReplyId || null,
      discussionNavigationTargetId: discussionId || null,
    },
  });
}

function resolveComposerKey(kind: DetailComposerKind): DetailComposerKey {
  return DETAIL_COMPOSER_KEYS[kind];
}

function resolveEditStateKey(kind: DetailEditKind): DetailEditStateKey {
  return DETAIL_EDIT_KEYS[kind];
}

function resolveSpeechConfig(kind: DetailEditKind): SpeechConfig {
  return kind === "discussion" ? DISCUSSION_SPEECH_CONFIG : ANNOTATION_SPEECH_CONFIG;
}

function getComposerState(kind: DetailComposerKind): ComposerState {
  return getClientState().detail[resolveComposerKey(kind)];
}

function updateComposerState(
  kind: DetailComposerKind,
  updater: (composer: ComposerState) => ComposerState
): void {
  const detail = getClientState().detail;
  const composerKey = resolveComposerKey(kind);

  updateClientState({
    detail: {
      ...detail,
      [composerKey]: updater(detail[composerKey]),
    },
  });
}

function getEditState(kind: DetailEditKind): EditState {
  return getClientState().detail[resolveEditStateKey(kind)];
}

function updateEditState(
  kind: DetailEditKind,
  updater: (editState: EditState) => EditState
): void {
  const detail = getClientState().detail;
  const editStateKey = resolveEditStateKey(kind);

  updateClientState({
    detail: {
      ...detail,
      [editStateKey]: updater(detail[editStateKey]),
    },
  });
}

function getSpeechRecords(kind: DetailEditKind): Array<Annotation | Discussion> {
  return kind === "discussion"
    ? getClientState().detail.discussions
    : getClientState().detail.annotations;
}

async function saveSpeechReply(
  kind: DetailEditKind
): Promise<Annotation | Discussion | null> {
  const config = resolveSpeechConfig(kind);
  const detail = getClientState().detail;
  const selectedThreadId =
    kind === "discussion" ? detail.selectedDiscussionId : detail.selectedAnnotationId;
  const selectedReplyId =
    kind === "discussion" ? detail.selectedDiscussionReplyId : detail.selectedReplyId;
  const replyTargetId = selectedReplyId || selectedThreadId;
  const composer =
    kind === "discussion" ? detail.discussionReplyComposer : detail.replyComposer;

  if (kind === "discussion") {
    const replyTarget =
      detail.discussions.find((item) => item.id === replyTargetId) || null;

    if (!getClientState().auth.currentUser || !replyTarget) {
      return null;
    }

    const note = String(composer.draft || "").trim();
    const files = composer.attachments;
    validateAttachmentFiles(files);

    if (!note && files.length === 0) {
      throw new Error("请先填写回复内容或选择附件。");
    }

    updateClientState({
      detail: {
        ...detail,
        isSavingDiscussionReply: true,
      },
    });

    try {
      const formData = createSpeechFormData({ note, attachments: files });
      const reply = await apiRequest<Discussion>(
        `${config.apiBasePath}/${encodeURIComponent(replyTarget.id)}/replies`,
        {
          method: "POST",
          body: formData,
        }
      );
      const nextRecords = [...getClientState().detail.discussions, reply].sort(
        config.sortRecords
      );

      updateClientState({
        detail: {
          ...getClientState().detail,
          discussions: nextRecords,
          selectedDiscussionReplyId: reply.id,
          discussionReplyComposer: createEmptyComposerState(),
        },
      });

      return reply;
    } finally {
      updateClientState({
        detail: {
          ...getClientState().detail,
          isSavingDiscussionReply: false,
        },
      });
    }
  }

  const replyTarget =
    detail.annotations.find((item) => item.id === replyTargetId) || null;

  if (!getClientState().auth.currentUser || !replyTarget) {
    return null;
  }

  const note = String(composer.draft || "").trim();
  const files = composer.attachments;
  validateAttachmentFiles(files);

  if (!note && files.length === 0) {
    throw new Error("请先填写回复内容或选择附件。");
  }

  updateClientState({
    detail: {
      ...detail,
      isSavingReply: true,
    },
  });

  try {
    const formData = createSpeechFormData({ note, attachments: files });
    const reply = await apiRequest<Annotation>(
      `${config.apiBasePath}/${encodeURIComponent(replyTarget.id)}/replies`,
      {
        method: "POST",
        body: formData,
      }
    );
    const nextRecords = [...getClientState().detail.annotations, reply].sort(
      config.sortRecords
    );

    updateClientState({
      detail: {
        ...getClientState().detail,
        annotations: nextRecords,
        selectedReplyId: reply.id,
        replyComposer: createEmptyComposerState(),
      },
    });

    return reply;
  } finally {
    updateClientState({
      detail: {
        ...getClientState().detail,
        isSavingReply: false,
      },
    });
  }
}

async function deleteSelectedSpeech(
  kind: DetailEditKind
): Promise<Annotation | Discussion | null> {
  const config = resolveSpeechConfig(kind);
  const detail = getClientState().detail;

  if (kind === "discussion") {
    const record =
      detail.discussions.find((item) => item.id === detail.selectedDiscussionId) || null;

    if (!record) {
      return null;
    }

    if (!canDeleteOwnedRecord(record, getClientState().auth.currentUser)) {
      throw new Error(`无权删除该${config.label}`);
    }

    await apiRequest(`${config.apiBasePath}/${encodeURIComponent(record.id)}`, {
      method: "DELETE",
    });

    updateClientState({
      detail: {
        ...getClientState().detail,
        discussions: getClientState().detail.discussions.filter(
          (item) => config.threadRootId(item) !== record.id
        ),
        selectedDiscussionId: null,
        selectedDiscussionReplyId: null,
        discussionNavigationTargetId: null,
        discussionReplyComposer: createEmptyComposerState(),
        discussionEditState: createEmptyEditState(),
      },
    });

    return record;
  }

  const record =
    detail.annotations.find((item) => item.id === detail.selectedAnnotationId) || null;

  if (!record) {
    return null;
  }

  if (!canDeleteOwnedRecord(record, getClientState().auth.currentUser)) {
    throw new Error(`无权删除该${config.label}`);
  }

  await apiRequest(`${config.apiBasePath}/${encodeURIComponent(record.id)}`, {
    method: "DELETE",
  });

  updateClientState({
    detail: {
      ...getClientState().detail,
      annotations: getClientState().detail.annotations.filter(
        (item) => config.threadRootId(item) !== record.id
      ),
      selectedAnnotationId: null,
      selectedReplyId: null,
      annotationNavigationTargetId: null,
      replyComposer: createEmptyComposerState(),
      annotationEditState: createEmptyEditState(),
    },
  });

  return record;
}

async function deleteSpeechReply(
  kind: DetailEditKind,
  replyId: string
): Promise<Annotation | Discussion | null> {
  const config = resolveSpeechConfig(kind);
  const detail = getClientState().detail;

  if (kind === "discussion") {
    const reply = detail.discussions.find((item) => item.id === replyId) || null;

    if (!reply) {
      return null;
    }

    if (!canDeleteOwnedRecord(reply, getClientState().auth.currentUser)) {
      throw new Error("无权删除该回复");
    }

    await apiRequest(`${config.apiBasePath}/${encodeURIComponent(reply.id)}`, {
      method: "DELETE",
    });

    updateClientState({
      detail: {
        ...getClientState().detail,
        discussions: getClientState().detail.discussions.filter(
          (item) => item.id !== reply.id
        ),
        selectedDiscussionReplyId:
          getClientState().detail.selectedDiscussionReplyId === reply.id
            ? null
            : getClientState().detail.selectedDiscussionReplyId,
      },
    });

    return reply;
  }

  const reply = detail.annotations.find((item) => item.id === replyId) || null;

  if (!reply) {
    return null;
  }

  if (!canDeleteOwnedRecord(reply, getClientState().auth.currentUser)) {
    throw new Error("无权删除该回复");
  }

  await apiRequest(`${config.apiBasePath}/${encodeURIComponent(reply.id)}`, {
    method: "DELETE",
  });

  updateClientState({
    detail: {
      ...getClientState().detail,
      annotations: getClientState().detail.annotations.filter(
        (item) => item.id !== reply.id
      ),
      selectedReplyId:
        getClientState().detail.selectedReplyId === reply.id
          ? null
          : getClientState().detail.selectedReplyId,
    },
  });

  return reply;
}
