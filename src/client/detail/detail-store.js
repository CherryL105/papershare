import * as sharedModule from "../../../shared/papershare-shared.js";
import { refreshPapers } from "../catalog/catalog-store.js";
import {
  createInitialDetailState,
  getClientState,
  isDetailPage,
  navigateToClientUrl,
  resolveDetailFocusState,
  updateClientState,
} from "../shared/client-store.js";
import {
  apiRequest,
  buildApiUrl,
  buildPaperDetailUrl,
  initializeSession,
} from "../shared/session-store.js";
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
} from "../shared/speech-helpers.js";
import {
  extractReadableArticleHtml,
  hasSelectionOverlap,
  readPaperIdFromHash,
  readPaperRouteFromQuery,
  supportsArticleImages,
  writePaperIdToHash,
} from "./detail-helpers.js";

const shared = sharedModule?.default || sharedModule;
const {
  canDeleteOwnedRecord,
  doesRecordBelongToUser,
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  isDiscussionReply,
  isReplyAnnotation,
} = shared;

const DETAIL_COMPOSER_KEYS = Object.freeze({
  annotation: "annotationComposer",
  discussion: "discussionComposer",
  discussionReply: "discussionReplyComposer",
  reply: "replyComposer",
});

const DETAIL_EDIT_KEYS = Object.freeze({
  annotation: "annotationEditState",
  discussion: "discussionEditState",
});

export async function initializeDetailPage(options = {}) {
  updateClientState({
    detail: {
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
        isInitializing: false,
      },
    });
  }
}

export async function syncDetailRouteFromLocation(options = {}) {
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

export async function handleDetailHashChange() {
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

export async function selectPaper(paperId, options = {}) {
  if (!getClientState().auth.currentUser) {
    return null;
  }

  const paper = getClientState().papers.items.find((item) => item.id === paperId);

  if (!paper) {
    return null;
  }

  const panel = options.panel === "discussion" ? "discussion" : getClientState().detail.libraryPanel;

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
    ? apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/content`)
        .then((content) => ({ content, error: null }))
        .catch((error) => ({ content: null, error }))
    : Promise.resolve({ content: null, error: null });
  const [paperDetail, annotations, discussions, prefetchedContentResult] = await Promise.all([
    apiRequest(`/api/papers/${encodeURIComponent(paper.id)}`),
    apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/annotations`),
    apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/discussions`),
    contentPromise,
  ]);

  let articleHtml = "";

  if (paperDetail.hasSnapshot || paperDetail.snapshotPath) {
    if (prefetchedContentResult.error) {
      throw prefetchedContentResult.error;
    }

    const content =
      prefetchedContentResult.content ||
      (await apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/content`));
    articleHtml = extractReadableArticleHtml(content.rawHtml, paperDetail.sourceUrl, {
      allowImages: supportsArticleImages(paperDetail),
      buildApiUrl,
    });
  }

  const sortedAnnotations = [...annotations].sort(compareAnnotationsForDisplay);
  const sortedDiscussions = [...discussions].sort(compareDiscussionsForDisplay);
  const focusState = resolveDetailFocusState(sortedAnnotations, sortedDiscussions, options);

  updateClientState({
    detail: {
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

export async function refreshSelectedPaperAnnotations() {
  if (!getClientState().auth.currentUser || !getClientState().detail.selectedPaperId) {
    updateClientState({
      detail: {
        annotations: [],
        selectedAnnotationId: null,
        selectedReplyId: null,
        annotationNavigationTargetId: null,
      },
    });
    return [];
  }

  const annotations = await apiRequest(
    `/api/papers/${encodeURIComponent(getClientState().detail.selectedPaperId)}/annotations`
  );
  const sortedAnnotations = [...annotations].sort(compareAnnotationsForDisplay);
  const topLevelAnnotationIds = new Set(
    sortedAnnotations.filter((item) => !isReplyAnnotation(item)).map((item) => item.id)
  );
  const annotationIds = new Set(sortedAnnotations.map((item) => item.id));

  updateClientState({
    detail: {
      annotations: sortedAnnotations,
      selectedAnnotationId: topLevelAnnotationIds.has(getClientState().detail.selectedAnnotationId)
        ? getClientState().detail.selectedAnnotationId
        : null,
      selectedReplyId: annotationIds.has(getClientState().detail.selectedReplyId)
        ? getClientState().detail.selectedReplyId
        : null,
    },
  });

  return sortedAnnotations;
}

export async function refreshSelectedPaperDiscussions() {
  if (!getClientState().auth.currentUser || !getClientState().detail.selectedPaperId) {
    updateClientState({
      detail: {
        discussions: [],
        selectedDiscussionId: null,
        selectedDiscussionReplyId: null,
        discussionNavigationTargetId: null,
      },
    });
    return [];
  }

  const discussions = await apiRequest(
    `/api/papers/${encodeURIComponent(getClientState().detail.selectedPaperId)}/discussions`
  );
  const sortedDiscussions = [...discussions].sort(compareDiscussionsForDisplay);
  const topLevelDiscussionIds = new Set(
    sortedDiscussions.filter((item) => !isDiscussionReply(item)).map((item) => item.id)
  );
  const discussionIds = new Set(sortedDiscussions.map((item) => item.id));

  updateClientState({
    detail: {
      discussions: sortedDiscussions,
      selectedDiscussionId: topLevelDiscussionIds.has(getClientState().detail.selectedDiscussionId)
        ? getClientState().detail.selectedDiscussionId
        : null,
      selectedDiscussionReplyId: discussionIds.has(getClientState().detail.selectedDiscussionReplyId)
        ? getClientState().detail.selectedDiscussionReplyId
        : null,
    },
  });

  return sortedDiscussions;
}

export function clearSelectedDetailPaper() {
  writePaperIdToHash("");
  updateClientState({
    detail: {
      ...createInitialDetailState(),
      libraryPanel: getClientState().detail.libraryPanel,
    },
  });
}

export function setLibraryPanel(panelName) {
  const nextPanel = panelName === "discussion" ? "discussion" : "reader";

  updateClientState({
    detail: {
      libraryPanel: nextPanel,
      pendingSelection: nextPanel === "discussion" ? null : getClientState().detail.pendingSelection,
    },
  });
}

export function setPendingSelection(selection) {
  updateClientState({
    detail: {
      pendingSelection: selection || null,
    },
  });
}

export function clearPendingSelection() {
  updateClientState({
    detail: {
      pendingSelection: null,
    },
  });
}

export function setDetailComposerDraft(kind, draft) {
  const composerKey = resolveComposerKey(kind);

  updateClientState({
    detail: {
      [composerKey]: {
        draft: String(draft || ""),
      },
    },
  });
}

export function addDetailComposerAttachments(kind, nextFiles) {
  const composerKey = resolveComposerKey(kind);
  const mergedFiles = mergeAttachmentFiles(getClientState().detail[composerKey].attachments, nextFiles);

  validateAttachmentFiles(mergedFiles);

  updateClientState({
    detail: {
      [composerKey]: {
        attachments: mergedFiles,
      },
    },
  });
}

export function removeDetailComposerAttachment(kind, index) {
  const composerKey = resolveComposerKey(kind);

  updateClientState({
    detail: {
      [composerKey]: {
        attachments: removeFileByIndex(getClientState().detail[composerKey].attachments, index),
      },
    },
  });
}

export function clearDetailComposerAttachments(kind) {
  const composerKey = resolveComposerKey(kind);

  updateClientState({
    detail: {
      [composerKey]: {
        attachments: [],
      },
    },
  });
}

export async function saveAnnotation() {
  const state = getClientState();
  const currentUser = state.auth.currentUser;
  const paper = state.detail.selectedPaper;
  const composer = state.detail.annotationComposer;
  const pendingSelection = state.detail.pendingSelection;

  if (!currentUser || !paper || !pendingSelection) {
    return null;
  }

  const note = String(composer.draft || "").trim();
  const attachments = composer.attachments || [];
  validateAttachmentFiles(attachments);

  if (!note && attachments.length === 0) {
    throw new Error("请先填写批注内容或选择附件。");
  }

  if (hasSelectionOverlap(getClientState().detail.annotations, pendingSelection)) {
    throw new Error("当前版本暂不支持重叠批注，请换一段未高亮的文本再试。");
  }

  updateClientState({
    detail: {
      isSavingAnnotation: true,
    },
  });

  try {
    const formData = createSpeechFormData({
      note,
      attachments,
      selection: pendingSelection,
    });
    const annotation = await apiRequest(
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
        isSavingAnnotation: false,
      },
    });
  }
}

export async function saveDiscussion() {
  const state = getClientState();
  const currentUser = state.auth.currentUser;
  const paper = state.detail.selectedPaper;
  const composer = state.detail.discussionComposer;

  if (!currentUser || !paper) {
    return null;
  }

  const note = String(composer.draft || "").trim();
  const attachments = composer.attachments || [];
  validateAttachmentFiles(attachments);

  if (!note && attachments.length === 0) {
    throw new Error("请先填写讨论内容或选择附件。");
  }

  updateClientState({
    detail: {
      isSavingDiscussion: true,
    },
  });

  try {
    const formData = createSpeechFormData({ note, attachments });
    const discussion = await apiRequest(
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
        isSavingDiscussion: false,
      },
    });
  }
}

export async function saveAnnotationReply() {
  return saveSpeechReply("annotation");
}

export async function saveDiscussionReply() {
  return saveSpeechReply("discussion");
}

export function selectAnnotationThread(annotationId) {
  updateClientState({
    detail: {
      selectedAnnotationId: annotationId || null,
      selectedReplyId: null,
      annotationNavigationTargetId: annotationId || null,
      annotationEditState: createEmptyEditState(),
    },
  });
}

export function selectDiscussionThread(discussionId) {
  updateClientState({
    detail: {
      selectedDiscussionId: discussionId || null,
      selectedDiscussionReplyId: null,
      discussionNavigationTargetId: discussionId || null,
      discussionEditState: createEmptyEditState(),
    },
  });
}

export function selectAnnotationReply(replyId) {
  const reply =
    getClientState().detail.annotations.find((annotation) => annotation.id === replyId) || null;

  updateClientState({
    detail: {
      selectedAnnotationId: reply ? getThreadRootAnnotationId(reply) : getClientState().detail.selectedAnnotationId,
      selectedReplyId: replyId || null,
      annotationNavigationTargetId: reply ? getThreadRootAnnotationId(reply) : null,
      annotationEditState: createEmptyEditState(),
    },
  });
}

export function selectDiscussionReply(replyId) {
  const reply =
    getClientState().detail.discussions.find((discussion) => discussion.id === replyId) || null;

  updateClientState({
    detail: {
      selectedDiscussionId: reply
        ? getThreadRootDiscussionId(reply)
        : getClientState().detail.selectedDiscussionId,
      selectedDiscussionReplyId: replyId || null,
      discussionNavigationTargetId: reply ? getThreadRootDiscussionId(reply) : null,
      discussionEditState: createEmptyEditState(),
    },
  });
}

export async function deleteSelectedAnnotation() {
  return deleteSelectedSpeech("annotation");
}

export async function deleteSelectedDiscussion() {
  return deleteSelectedSpeech("discussion");
}

export async function deleteAnnotationReply(replyId) {
  return deleteSpeechReply("annotation", replyId);
}

export async function deleteDiscussionReply(replyId) {
  return deleteSpeechReply("discussion", replyId);
}

export async function clearSelectedPaperAnnotations() {
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
      annotations: nextAnnotations,
      pendingSelection: null,
      selectedAnnotationId: ownAnnotationIds.has(getClientState().detail.selectedAnnotationId)
        ? null
        : getClientState().detail.selectedAnnotationId,
      selectedReplyId: ownAnnotationIds.has(getClientState().detail.selectedReplyId)
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

export async function deleteSelectedPaper() {
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

export function startDetailEdit(kind, recordId, targetType = kind) {
  const config = resolveSpeechConfig(kind);
  const record = getClientState().detail[config.recordsKey].find((item) => item.id === recordId);

  if (!record) {
    return;
  }

  const nextEditState = {
    targetId: record.id,
    targetType,
    draft: record.note || "",
    attachments: createEditableAttachmentItems(record.attachments),
    isSaving: false,
  };

  updateClientState({
    detail: {
      [config.editStateKey]: nextEditState,
      ...(targetType === "reply" ? { [config.selectedReplyKey]: record.id } : {}),
    },
  });
}

export function cancelDetailEdit(kind) {
  const editStateKey = resolveEditStateKey(kind);

  updateClientState({
    detail: {
      [editStateKey]: createEmptyEditState(),
    },
  });
}

export function setDetailEditDraft(kind, draft) {
  const editStateKey = resolveEditStateKey(kind);

  updateClientState({
    detail: {
      [editStateKey]: {
        draft: String(draft || ""),
      },
    },
  });
}

export function addDetailEditAttachments(kind, nextFiles) {
  const editStateKey = resolveEditStateKey(kind);
  const currentItems = getClientState().detail[editStateKey].attachments;
  const nextItems = appendFilesToEditableItems(currentItems, nextFiles);

  validateEditableAttachmentItems(nextItems);

  updateClientState({
    detail: {
      [editStateKey]: {
        attachments: nextItems,
      },
    },
  });
}

export function clearDetailEditAttachments(kind) {
  const editStateKey = resolveEditStateKey(kind);

  updateClientState({
    detail: {
      [editStateKey]: {
        attachments: [],
      },
    },
  });
}

export function removeDetailEditAttachment(kind, key) {
  const editStateKey = resolveEditStateKey(kind);

  updateClientState({
    detail: {
      [editStateKey]: {
        attachments: removeEditableAttachmentByKey(
          getClientState().detail[editStateKey].attachments,
          key
        ),
      },
    },
  });
}

export async function saveDetailEdit(kind) {
  const config = resolveSpeechConfig(kind);
  const editState = getClientState().detail[config.editStateKey];
  const record = getClientState().detail[config.recordsKey].find((item) => item.id === editState.targetId);

  if (!record || editState.isSaving) {
    return null;
  }

  const nextNote = String(editState.draft || "").trim();
  const nextAttachments = editState.attachments || [];

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

  updateClientState({
    detail: {
      [config.editStateKey]: {
        isSaving: true,
      },
    },
  });

  try {
    const attachments = splitEditableAttachmentItems(nextAttachments);
    const formData = createSpeechFormData({
      note: nextNote,
      attachments: attachments.newFiles,
      retainedAttachments: attachments.existingAttachments,
    });
    const updated = await apiRequest(`${config.apiBasePath}/${encodeURIComponent(record.id)}`, {
      method: "PATCH",
      body: formData,
    });
    const nextRecords = getClientState().detail[config.recordsKey]
      .map((item) => (item.id === updated.id ? updated : item))
      .sort(config.sortRecords);

    updateClientState({
      detail: {
        [config.recordsKey]: nextRecords,
        [config.editStateKey]: createEmptyEditState(),
        ...(editState.targetType === "reply" ? { [config.selectedReplyKey]: updated.id } : {}),
      },
    });

    return updated;
  } finally {
    if (getClientState().detail[config.editStateKey].targetId) {
      updateClientState({
        detail: {
          [config.editStateKey]: {
            isSaving: false,
          },
        },
      });
    }
  }
}

export async function openAnnotationLocation(paperId, annotationId, options = {}) {
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
      selectedAnnotationId: annotationId || null,
      selectedReplyId: focusReplyId || null,
      annotationNavigationTargetId: annotationId || null,
    },
  });
}

export async function openDiscussionLocation(paperId, discussionId, options = {}) {
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
      selectedDiscussionId: discussionId || null,
      selectedDiscussionReplyId: focusReplyId || null,
      discussionNavigationTargetId: discussionId || null,
    },
  });
}

function resolveComposerKey(kind) {
  return DETAIL_COMPOSER_KEYS[kind] || DETAIL_COMPOSER_KEYS.annotation;
}

function resolveEditStateKey(kind) {
  return DETAIL_EDIT_KEYS[kind] || DETAIL_EDIT_KEYS.annotation;
}

function resolveSpeechConfig(kind) {
  if (kind === "discussion") {
    return {
      apiBasePath: "/api/discussions",
      editStateKey: "discussionEditState",
      label: "讨论",
      recordsKey: "discussions",
      replyComposerKey: "discussionReplyComposer",
      replySavingKey: "isSavingDiscussionReply",
      selectedReplyKey: "selectedDiscussionReplyId",
      selectedThreadKey: "selectedDiscussionId",
      sortRecords: compareDiscussionsForDisplay,
      threadRootId: getThreadRootDiscussionId,
    };
  }

  return {
    apiBasePath: "/api/annotations",
    editStateKey: "annotationEditState",
    label: "批注",
    recordsKey: "annotations",
    replyComposerKey: "replyComposer",
    replySavingKey: "isSavingReply",
    selectedReplyKey: "selectedReplyId",
    selectedThreadKey: "selectedAnnotationId",
    sortRecords: compareAnnotationsForDisplay,
    threadRootId: getThreadRootAnnotationId,
  };
}

async function saveSpeechReply(kind) {
  const config = resolveSpeechConfig(kind);
  const selectedThreadId = getClientState().detail[config.selectedThreadKey];
  const selectedReplyId = getClientState().detail[config.selectedReplyKey];
  const replyTargetId = selectedReplyId || selectedThreadId;
  const replyTarget =
    getClientState().detail[config.recordsKey].find((item) => item.id === replyTargetId) || null;
  const composer = getClientState().detail[config.replyComposerKey];

  if (!getClientState().auth.currentUser || !replyTarget) {
    return null;
  }

  const note = String(composer.draft || "").trim();
  const attachments = composer.attachments || [];
  validateAttachmentFiles(attachments);

  if (!note && attachments.length === 0) {
    throw new Error("请先填写回复内容或选择附件。");
  }

  updateClientState({
    detail: {
      [config.replySavingKey]: true,
    },
  });

  try {
    const formData = createSpeechFormData({ note, attachments });
    const reply = await apiRequest(
      `${config.apiBasePath}/${encodeURIComponent(replyTarget.id)}/replies`,
      {
        method: "POST",
        body: formData,
      }
    );
    const nextRecords = [...getClientState().detail[config.recordsKey], reply].sort(config.sortRecords);

    updateClientState({
      detail: {
        [config.recordsKey]: nextRecords,
        [config.selectedReplyKey]: reply.id,
        [config.replyComposerKey]: createEmptyComposerState(),
      },
    });

    return reply;
  } finally {
    updateClientState({
      detail: {
        [config.replySavingKey]: false,
      },
    });
  }
}

async function deleteSelectedSpeech(kind) {
  const config = resolveSpeechConfig(kind);
  const record =
    getClientState().detail[config.recordsKey].find(
      (item) => item.id === getClientState().detail[config.selectedThreadKey]
    ) || null;

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
      [config.recordsKey]: getClientState().detail[config.recordsKey].filter(
        (item) => config.threadRootId(item) !== record.id
      ),
      [config.selectedThreadKey]: null,
      [config.selectedReplyKey]: null,
      ...(kind === "discussion"
        ? {
            discussionNavigationTargetId: null,
            discussionReplyComposer: createEmptyComposerState(),
            discussionEditState: createEmptyEditState(),
          }
        : {
            annotationNavigationTargetId: null,
            replyComposer: createEmptyComposerState(),
            annotationEditState: createEmptyEditState(),
          }),
    },
  });

  return record;
}

async function deleteSpeechReply(kind, replyId) {
  const config = resolveSpeechConfig(kind);
  const reply =
    getClientState().detail[config.recordsKey].find((item) => item.id === replyId) || null;

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
      [config.recordsKey]: getClientState().detail[config.recordsKey].filter((item) => item.id !== reply.id),
      [config.selectedReplyKey]:
        getClientState().detail[config.selectedReplyKey] === reply.id
          ? null
          : getClientState().detail[config.selectedReplyKey],
    },
  });

  return reply;
}
