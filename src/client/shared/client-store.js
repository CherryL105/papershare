import { useEffect, useState } from "preact/hooks";
import * as sharedModule from "../../../shared/papershare-shared.js";
import {
  appendFilesToEditableItems,
  areEditableAttachmentsUnchanged,
  compareAnnotationsForDisplay,
  compareDiscussionsForDisplay,
  createEditableAttachmentItems,
  createEmptyComposerState,
  createEmptyEditState,
  createSpeechFormData,
  extractReadableArticleHtml,
  hasSelectionOverlap,
  mergeAttachmentFiles,
  readPaperIdFromHash,
  readPaperRouteFromQuery,
  removeEditableAttachmentByKey,
  removeFileByIndex,
  splitEditableAttachmentItems,
  supportsArticleImages,
  validateAttachmentFiles,
  validateEditableAttachmentItems,
  writePaperIdToHash,
} from "../detail/detail-helpers.js";

const shared = sharedModule?.default || sharedModule;
const {
  canDeleteOwnedRecord,
  doesRecordBelongToUser,
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  isDiscussionReply,
  isReplyAnnotation,
} = shared;

const DEFAULT_API_ORIGIN = "http://127.0.0.1:3000";
const API_BASE_URL_STORAGE_KEY = "papershare_api_base_url";
const SESSION_TOKEN_STORAGE_KEY = "papershare_session_token";
const CURRENT_USER_STORAGE_KEY = "papershare_current_user";
const LIBRARY_INDEX_PATH = "./index.html";
const PAPER_DETAIL_PATH = "./paper.html";

const listeners = new Set();
let navigateToUrl = defaultNavigateToUrl;

let clientState = createInitialClientState();

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

export function getClientState() {
  return clientState;
}

export function subscribeClientState(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useClientState() {
  const [snapshot, setSnapshot] = useState(clientState);

  useEffect(() => subscribeClientState(setSnapshot), []);

  return snapshot;
}

export async function initializeSession() {
  updateClientState({
    auth: {
      isInitializing: true,
      loginStatus: "正在恢复登录状态...",
    },
  });

  try {
    const authState = await apiRequest("/api/auth/me");

    if (authState.authenticated && authState.user) {
      applyAuthenticatedState(authState.user, `已登录为 ${authState.user.username}`);
    } else {
      clearPersistedSession();
      updateClientState({
        auth: {
          currentUser: null,
          serverReady: true,
          loginStatus: "请输入账号密码",
          databaseStatus: "服务已连接，请先登录",
        },
        papers: {
          items: [],
        },
        catalog: {
          paperFormStatus: "登录后可抓取文献",
          searchTerm: "",
        },
        detail: createInitialDetailState(),
      });
    }
  } catch (error) {
    updateClientState({
      auth: {
        currentUser: null,
        serverReady: false,
        loginStatus: "无法连接服务",
        databaseStatus: `服务未启动（API: ${clientState.session.apiBaseUrl}）`,
      },
      papers: {
        items: [],
      },
      catalog: {
        paperFormStatus: "请先启动 server.js",
      },
      detail: createInitialDetailState(),
    });
    throw error;
  } finally {
    updateClientState({
      auth: {
        isInitializing: false,
      },
    });
  }

  return {
    authenticated: Boolean(clientState.auth.currentUser),
    user: clientState.auth.currentUser,
  };
}

export async function login({ username, password }) {
  updateClientState({
    auth: {
      isLoggingIn: true,
      loginStatus: "登录中...",
    },
  });

  try {
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    applyAuthenticatedState(result.user, `已登录为 ${result.user.username}`);
    return result;
  } catch (error) {
    updateClientState({
      auth: {
        loginStatus: error.message || "登录失败",
      },
    });
    throw error;
  } finally {
    updateClientState({
      auth: {
        isLoggingIn: false,
      },
    });
  }
}

export async function logout() {
  try {
    await apiRequest("/api/auth/logout", {
      method: "POST",
    });
  } catch (error) {
    // Keep logout resilient even when the server request fails.
  } finally {
    applyLoggedOutState("请输入账号密码");
  }
}

export async function refreshPapers() {
  if (!clientState.auth.currentUser) {
    updateClientState({
      papers: {
        items: [],
      },
      detail: {
        selectedPaper: null,
        selectedPaperId: "",
      },
    });
    return [];
  }

  const papers = await apiRequest("/api/papers");
  const sortedPapers = [...papers].sort(comparePapersForList);
  const selectedPaper =
    sortedPapers.find((paper) => paper.id === clientState.detail.selectedPaperId) || null;

  updateClientState({
    papers: {
      items: sortedPapers,
    },
    detail: {
      selectedPaper: selectedPaper || clientState.detail.selectedPaper,
    },
  });

  return sortedPapers;
}

export async function submitPaper({ sourceUrl, rawHtml }) {
  const normalizedSourceUrl = String(sourceUrl || "").trim();
  const normalizedRawHtml = String(rawHtml || "");
  const isHtmlImport = Boolean(normalizedRawHtml.trim());
  const isElsevierUpload = /(?:sciencedirect|elsevier)\.com/i.test(normalizedSourceUrl);

  updateClientState({
    catalog: {
      isSavingPaper: true,
      paperFormStatus: isHtmlImport
        ? "正在导入源码并写入 storage..."
        : isElsevierUpload
          ? "正在通过内置 Elsevier API 获取全文并写入 storage..."
          : "正在抓取网页并写入 storage...",
    },
  });

  try {
    const savedPaper = await apiRequest(isHtmlImport ? "/api/papers/import-html" : "/api/papers", {
      method: "POST",
      body: JSON.stringify({
        sourceUrl: normalizedSourceUrl,
        rawHtml: normalizedRawHtml,
      }),
    });

    updateClientState({
      catalog: {
        paperFormStatus: isHtmlImport
          ? "源码导入成功，已写入 storage"
          : isElsevierUpload
            ? "Elsevier 全文导入成功，已写入 storage"
            : "抓取成功，已写入 storage",
      },
    });

    await refreshPapers();
    return savedPaper;
  } catch (error) {
    updateClientState({
      catalog: {
        paperFormStatus: shouldOfferBrowserFetchFallback(error.message || "")
          ? "目标站点需要人工验证，请改用浏览器打开原文并导入 HTML 快照"
          : error.message || "抓取失败",
      },
    });
    throw error;
  } finally {
    updateClientState({
      catalog: {
        isSavingPaper: false,
      },
    });
  }
}

export async function initializeDetailPage(options = {}) {
  updateClientState({
    detail: {
      isInitializing: true,
    },
  });

  try {
    const authState = options.skipSessionInit
      ? {
          authenticated: Boolean(clientState.auth.currentUser),
          user: clientState.auth.currentUser,
        }
      : await initializeSession();

    if (!authState.authenticated || !authState.user) {
      updateClientState({
        detail: createInitialDetailState(),
      });
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
  if (!clientState.auth.currentUser) {
    return null;
  }

  const papers = Array.isArray(options.papers) ? options.papers : clientState.papers.items;
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

  if (options.forceReload || clientState.detail.selectedPaperId !== fallbackPaperId) {
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
      ...resolveDetailFocusState(clientState.detail.annotations, clientState.detail.discussions, {
        focusAnnotationId: route.annotationId,
        focusReplyId: route.replyId,
        focusDiscussionId: route.discussionId,
        focusDiscussionReplyId: route.discussionReplyId,
      }),
    },
  });

  return clientState.detail.selectedPaper;
}

export async function handleDetailHashChange() {
  if (!clientState.auth.currentUser) {
    return null;
  }

  const paperId = readPaperIdFromHash();

  if (!paperId || paperId === clientState.detail.selectedPaperId) {
    return null;
  }

  if (!clientState.papers.items.some((paper) => paper.id === paperId)) {
    return null;
  }

  return selectPaper(paperId, { updateHash: false });
}

export async function selectPaper(paperId, options = {}) {
  if (!clientState.auth.currentUser) {
    return null;
  }

  const paper = clientState.papers.items.find((item) => item.id === paperId);

  if (!paper) {
    return null;
  }

  const panel = options.panel === "discussion" ? "discussion" : clientState.detail.libraryPanel;

  updateClientState({
    detail: {
      ...createInitialDetailState(),
      libraryPanel: panel,
      selectedPaperId: paper.id,
      selectedPaper: paper,
    },
  });

  const [paperDetail, annotations, discussions] = await Promise.all([
    apiRequest(`/api/papers/${encodeURIComponent(paper.id)}`),
    apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/annotations`),
    apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/discussions`),
  ]);

  let articleHtml = "";

  if (paperDetail.hasSnapshot) {
    const content = await apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/content`);
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
  if (!clientState.auth.currentUser || !clientState.detail.selectedPaperId) {
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
    `/api/papers/${encodeURIComponent(clientState.detail.selectedPaperId)}/annotations`
  );
  const sortedAnnotations = [...annotations].sort(compareAnnotationsForDisplay);
  const topLevelAnnotationIds = new Set(sortedAnnotations.filter((item) => !isReplyAnnotation(item)).map((item) => item.id));
  const annotationIds = new Set(sortedAnnotations.map((item) => item.id));

  updateClientState({
    detail: {
      annotations: sortedAnnotations,
      selectedAnnotationId: topLevelAnnotationIds.has(clientState.detail.selectedAnnotationId)
        ? clientState.detail.selectedAnnotationId
        : null,
      selectedReplyId: annotationIds.has(clientState.detail.selectedReplyId)
        ? clientState.detail.selectedReplyId
        : null,
    },
  });

  return sortedAnnotations;
}

export async function refreshSelectedPaperDiscussions() {
  if (!clientState.auth.currentUser || !clientState.detail.selectedPaperId) {
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
    `/api/papers/${encodeURIComponent(clientState.detail.selectedPaperId)}/discussions`
  );
  const sortedDiscussions = [...discussions].sort(compareDiscussionsForDisplay);
  const topLevelDiscussionIds = new Set(
    sortedDiscussions.filter((item) => !isDiscussionReply(item)).map((item) => item.id)
  );
  const discussionIds = new Set(sortedDiscussions.map((item) => item.id));

  updateClientState({
    detail: {
      discussions: sortedDiscussions,
      selectedDiscussionId: topLevelDiscussionIds.has(clientState.detail.selectedDiscussionId)
        ? clientState.detail.selectedDiscussionId
        : null,
      selectedDiscussionReplyId: discussionIds.has(clientState.detail.selectedDiscussionReplyId)
        ? clientState.detail.selectedDiscussionReplyId
        : null,
    },
  });

  return sortedDiscussions;
}

export function setLibraryPanel(panelName) {
  const nextPanel = panelName === "discussion" ? "discussion" : "reader";

  updateClientState({
    detail: {
      libraryPanel: nextPanel,
      pendingSelection: nextPanel === "discussion" ? null : clientState.detail.pendingSelection,
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
  const mergedFiles = mergeAttachmentFiles(clientState.detail[composerKey].attachments, nextFiles);

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
        attachments: removeFileByIndex(clientState.detail[composerKey].attachments, index),
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
  const currentUser = clientState.auth.currentUser;
  const paper = clientState.detail.selectedPaper;
  const composer = clientState.detail.annotationComposer;
  const pendingSelection = clientState.detail.pendingSelection;

  if (!currentUser || !paper || !pendingSelection) {
    return null;
  }

  const note = String(composer.draft || "").trim();
  const attachments = composer.attachments || [];
  validateAttachmentFiles(attachments);

  if (!note && attachments.length === 0) {
    throw new Error("请先填写批注内容或选择附件。");
  }

  if (hasSelectionOverlap(clientState.detail.annotations, pendingSelection)) {
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
    const nextAnnotations = [...clientState.detail.annotations, annotation].sort(
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
  const currentUser = clientState.auth.currentUser;
  const paper = clientState.detail.selectedPaper;
  const composer = clientState.detail.discussionComposer;

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
    const nextDiscussions = [...clientState.detail.discussions, discussion].sort(
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
    clientState.detail.annotations.find((annotation) => annotation.id === replyId) || null;

  updateClientState({
    detail: {
      selectedAnnotationId: reply ? getThreadRootAnnotationId(reply) : clientState.detail.selectedAnnotationId,
      selectedReplyId: replyId || null,
      annotationNavigationTargetId: reply ? getThreadRootAnnotationId(reply) : null,
      annotationEditState: createEmptyEditState(),
    },
  });
}

export function selectDiscussionReply(replyId) {
  const reply =
    clientState.detail.discussions.find((discussion) => discussion.id === replyId) || null;

  updateClientState({
    detail: {
      selectedDiscussionId: reply
        ? getThreadRootDiscussionId(reply)
        : clientState.detail.selectedDiscussionId,
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
  const currentUser = clientState.auth.currentUser;
  const paper = clientState.detail.selectedPaper;

  if (!currentUser || !paper) {
    return { ok: false, deletedCount: 0 };
  }

  await apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/annotations`, {
    method: "DELETE",
  });

  const ownAnnotationIds = new Set(
    clientState.detail.annotations
      .filter((annotation) => doesRecordBelongToUser(annotation, currentUser))
      .map((annotation) => annotation.id)
  );
  const nextAnnotations = clientState.detail.annotations.filter((annotation) => {
    const threadRootId = getThreadRootAnnotationId(annotation);
    return !ownAnnotationIds.has(annotation.id) && !ownAnnotationIds.has(threadRootId);
  });

  updateClientState({
    detail: {
      annotations: nextAnnotations,
      pendingSelection: null,
      selectedAnnotationId: ownAnnotationIds.has(clientState.detail.selectedAnnotationId)
        ? null
        : clientState.detail.selectedAnnotationId,
      selectedReplyId: ownAnnotationIds.has(clientState.detail.selectedReplyId)
        ? null
        : clientState.detail.selectedReplyId,
      annotationNavigationTargetId: null,
      annotationComposer: createEmptyComposerState(),
      replyComposer: createEmptyComposerState(),
      annotationEditState: createEmptyEditState(),
    },
  });

  return { ok: true, deletedCount: ownAnnotationIds.size };
}

export async function deleteSelectedPaper() {
  const paper = clientState.detail.selectedPaper;
  const currentUser = clientState.auth.currentUser;

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
      panel: clientState.detail.libraryPanel,
      updateHash: true,
    });
  }

  writePaperIdToHash("");
  updateClientState({
    detail: {
      ...createInitialDetailState(),
      libraryPanel: clientState.detail.libraryPanel,
    },
  });

  return null;
}

export function startDetailEdit(kind, recordId, targetType = kind) {
  const config = resolveSpeechConfig(kind);
  const record = clientState.detail[config.recordsKey].find((item) => item.id === recordId);

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
  const currentItems = clientState.detail[editStateKey].attachments;
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
          clientState.detail[editStateKey].attachments,
          key
        ),
      },
    },
  });
}

export async function saveDetailEdit(kind) {
  const config = resolveSpeechConfig(kind);
  const editState = clientState.detail[config.editStateKey];
  const record = clientState.detail[config.recordsKey].find((item) => item.id === editState.targetId);

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
    const nextRecords = clientState.detail[config.recordsKey]
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
    if (clientState.detail[config.editStateKey].targetId) {
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
    navigateToUrl(
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

  if (clientState.detail.selectedPaperId !== paperId) {
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
    navigateToUrl(
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

  if (clientState.detail.selectedPaperId !== paperId) {
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

export function navigateToLibraryIndex() {
  navigateToUrl(LIBRARY_INDEX_PATH);
}

export function setPaperSearch(term) {
  updateClientState({
    catalog: {
      searchTerm: String(term || "").trim().toLowerCase(),
    },
  });
}

export function setPaperFormStatus(message) {
  updateClientState({
    catalog: {
      paperFormStatus: String(message || "").trim(),
    },
  });
}

export function buildPaperDetailUrl(options = {}) {
  const params = new URLSearchParams();

  if (options.paperId) {
    params.set("paperId", options.paperId);
  }
  if (options.panel) {
    params.set("panel", options.panel);
  }
  if (options.annotationId) {
    params.set("annotationId", options.annotationId);
  }
  if (options.replyId) {
    params.set("replyId", options.replyId);
  }
  if (options.discussionId) {
    params.set("discussionId", options.discussionId);
  }
  if (options.discussionReplyId) {
    params.set("discussionReplyId", options.discussionReplyId);
  }

  const query = params.toString();
  return query ? `${PAPER_DETAIL_PATH}?${query}` : PAPER_DETAIL_PATH;
}

export function openPaperDetail(input) {
  const options =
    input && typeof input === "object" ? input : { paperId: input, panel: "reader" };

  if (!options.paperId) {
    return;
  }

  navigateToUrl(
    buildPaperDetailUrl({
      panel: "reader",
      ...options,
    })
  );
}

export function getVisiblePapers(papers, searchTerm) {
  const normalizedSearchTerm = String(searchTerm || "").trim().toLowerCase();

  if (!normalizedSearchTerm) {
    return Array.isArray(papers) ? papers : [];
  }

  return (Array.isArray(papers) ? papers : []).filter((paper) =>
    matchesPaperSearchTerm(paper, normalizedSearchTerm)
  );
}

export function shouldOfferBrowserFetchFallback(message) {
  return /403|forbidden|captcha|cloudflare|challenge/i.test(String(message || ""));
}

export function formatDateTime(value) {
  if (!value) {
    return "时间未知";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function buildApiUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return new URL(path, `${clientState.session.apiBaseUrl}/`).toString();
}

export async function apiRequest(path, options = {}) {
  const isFormDataBody = options.body instanceof FormData;
  const requestOptions = {
    credentials: "include",
    headers: {
      ...(isFormDataBody ? {} : { "Content-Type": "application/json" }),
      ...(clientState.session.token
        ? { Authorization: `Bearer ${clientState.session.token}` }
        : {}),
      ...(options.headers || {}),
    },
    ...options,
  };

  if (requestOptions.method === "GET" || requestOptions.method === "DELETE" || isFormDataBody) {
    delete requestOptions.headers["Content-Type"];
  }

  let response;

  try {
    response = await fetch(buildApiUrl(path), requestOptions);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `无法连接到 PaperShare 服务，请先运行 server.js，并确认页面能访问 ${clientState.session.apiBaseUrl}`
      );
    }

    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    applyLoggedOutState(data.error || "登录已失效，请重新登录");
  }

  if (response.status === 403 && data.code === "PASSWORD_CHANGE_REQUIRED") {
    const nextUser = {
      ...(clientState.auth.currentUser || {}),
      mustChangePassword: true,
    };

    persistCurrentUser(nextUser);
    updateClientState({
      auth: {
        currentUser: nextUser,
      },
      catalog: {
        paperFormStatus: "修改密码后可抓取文献",
      },
    });
  }

  if (response.ok && data.token) {
    persistSessionToken(data.token);
    updateClientState({
      session: {
        token: String(data.token || ""),
      },
    });
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
}

export function resetClientStoreForTests(overrides = {}) {
  clearPersistedSession();
  navigateToUrl = defaultNavigateToUrl;
  clientState = mergeClientState(createInitialClientState(), overrides);
  emitClientState();
}

export function setClientStateForTests(partial) {
  updateClientState(partial);
}

export function setNavigationHandlerForTests(handler) {
  navigateToUrl = typeof handler === "function" ? handler : defaultNavigateToUrl;
}

function createInitialClientState() {
  const token = readSessionToken();
  const currentUser = token ? readStoredCurrentUser() : null;

  return {
    session: {
      apiBaseUrl: resolveApiBaseUrl(),
      token,
    },
    auth: {
      currentUser,
      isInitializing: true,
      serverReady: false,
      isLoggingIn: false,
      loginStatus: "请输入账号密码",
      databaseStatus: "服务初始化中...",
    },
    papers: {
      items: [],
    },
    catalog: {
      paperFormStatus: "等待抓取",
      searchTerm: "",
      isSavingPaper: false,
    },
    detail: createInitialDetailState(),
  };
}

function createInitialDetailState() {
  return {
    isInitializing: false,
    libraryPanel: "reader",
    selectedPaperId: "",
    selectedPaper: null,
    articleHtml: "",
    articleLoaded: false,
    pendingSelection: null,
    annotations: [],
    discussions: [],
    selectedAnnotationId: null,
    selectedReplyId: null,
    annotationNavigationTargetId: null,
    selectedDiscussionId: null,
    selectedDiscussionReplyId: null,
    discussionNavigationTargetId: null,
    isSavingAnnotation: false,
    isSavingReply: false,
    isSavingDiscussion: false,
    isSavingDiscussionReply: false,
    annotationComposer: createEmptyComposerState(),
    replyComposer: createEmptyComposerState(),
    discussionComposer: createEmptyComposerState(),
    discussionReplyComposer: createEmptyComposerState(),
    annotationEditState: createEmptyEditState(),
    discussionEditState: createEmptyEditState(),
  };
}

function emitClientState() {
  listeners.forEach((listener) => {
    listener(clientState);
  });
}

function updateClientState(partial) {
  clientState = mergeClientState(
    clientState,
    typeof partial === "function" ? partial(clientState) : partial
  );
  emitClientState();
  return clientState;
}

function mergeClientState(baseState, partialState = {}) {
  return {
    ...baseState,
    ...partialState,
    session: partialState.session ? { ...baseState.session, ...partialState.session } : baseState.session,
    auth: partialState.auth ? { ...baseState.auth, ...partialState.auth } : baseState.auth,
    papers: partialState.papers ? { ...baseState.papers, ...partialState.papers } : baseState.papers,
    catalog: partialState.catalog
      ? { ...baseState.catalog, ...partialState.catalog }
      : baseState.catalog,
    detail: partialState.detail ? mergeDetailState(baseState.detail, partialState.detail) : baseState.detail,
  };
}

function mergeDetailState(baseDetailState, partialDetailState = {}) {
  return {
    ...baseDetailState,
    ...partialDetailState,
    annotationComposer: partialDetailState.annotationComposer
      ? { ...baseDetailState.annotationComposer, ...partialDetailState.annotationComposer }
      : baseDetailState.annotationComposer,
    replyComposer: partialDetailState.replyComposer
      ? { ...baseDetailState.replyComposer, ...partialDetailState.replyComposer }
      : baseDetailState.replyComposer,
    discussionComposer: partialDetailState.discussionComposer
      ? { ...baseDetailState.discussionComposer, ...partialDetailState.discussionComposer }
      : baseDetailState.discussionComposer,
    discussionReplyComposer: partialDetailState.discussionReplyComposer
      ? {
          ...baseDetailState.discussionReplyComposer,
          ...partialDetailState.discussionReplyComposer,
        }
      : baseDetailState.discussionReplyComposer,
    annotationEditState: partialDetailState.annotationEditState
      ? { ...baseDetailState.annotationEditState, ...partialDetailState.annotationEditState }
      : baseDetailState.annotationEditState,
    discussionEditState: partialDetailState.discussionEditState
      ? { ...baseDetailState.discussionEditState, ...partialDetailState.discussionEditState }
      : baseDetailState.discussionEditState,
  };
}

function applyAuthenticatedState(user, loginStatus) {
  persistCurrentUser(user);
  updateClientState({
    auth: {
      currentUser: user,
      serverReady: true,
      loginStatus,
      databaseStatus: "服务已连接",
    },
    catalog: {
      paperFormStatus: user?.mustChangePassword ? "修改密码后可抓取文献" : "等待抓取",
    },
  });
}

function applyLoggedOutState(loginStatus) {
  clearPersistedSession();
  updateClientState({
    session: {
      token: "",
    },
    auth: {
      currentUser: null,
      loginStatus,
      databaseStatus: clientState.auth.serverReady ? "服务已连接，请先登录" : "服务未启动",
    },
    papers: {
      items: [],
    },
    catalog: {
      isSavingPaper: false,
      paperFormStatus: clientState.auth.serverReady ? "登录后可抓取文献" : "请先启动 server.js",
      searchTerm: "",
    },
    detail: createInitialDetailState(),
  });
}

function resolveDetailFocusState(annotations, discussions, options = {}) {
  const topLevelAnnotations = new Set(
    annotations.filter((annotation) => !isReplyAnnotation(annotation)).map((annotation) => annotation.id)
  );
  const annotationIds = new Set(annotations.map((annotation) => annotation.id));
  const topLevelDiscussions = new Set(
    discussions
      .filter((discussion) => !isDiscussionReply(discussion))
      .map((discussion) => discussion.id)
  );
  const discussionIds = new Set(discussions.map((discussion) => discussion.id));

  return {
    selectedAnnotationId: topLevelAnnotations.has(options.focusAnnotationId)
      ? options.focusAnnotationId
      : null,
    selectedReplyId: annotationIds.has(options.focusReplyId) ? options.focusReplyId : null,
    annotationNavigationTargetId: topLevelAnnotations.has(options.focusAnnotationId)
      ? options.focusAnnotationId
      : null,
    selectedDiscussionId: topLevelDiscussions.has(options.focusDiscussionId)
      ? options.focusDiscussionId
      : null,
    selectedDiscussionReplyId: discussionIds.has(options.focusDiscussionReplyId)
      ? options.focusDiscussionReplyId
      : null,
    discussionNavigationTargetId: topLevelDiscussions.has(options.focusDiscussionId)
      ? options.focusDiscussionId
      : null,
  };
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
  const selectedThreadId = clientState.detail[config.selectedThreadKey];
  const selectedReplyId = clientState.detail[config.selectedReplyKey];
  const replyTargetId = selectedReplyId || selectedThreadId;
  const replyTarget =
    clientState.detail[config.recordsKey].find((item) => item.id === replyTargetId) || null;
  const composer = clientState.detail[config.replyComposerKey];

  if (!clientState.auth.currentUser || !replyTarget) {
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
    const nextRecords = [...clientState.detail[config.recordsKey], reply].sort(config.sortRecords);

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
    clientState.detail[config.recordsKey].find(
      (item) => item.id === clientState.detail[config.selectedThreadKey]
    ) || null;

  if (!record) {
    return null;
  }

  if (!canDeleteOwnedRecord(record, clientState.auth.currentUser)) {
    throw new Error(`无权删除该${config.label}`);
  }

  await apiRequest(`${config.apiBasePath}/${encodeURIComponent(record.id)}`, {
    method: "DELETE",
  });

  updateClientState({
    detail: {
      [config.recordsKey]: clientState.detail[config.recordsKey].filter(
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
    clientState.detail[config.recordsKey].find((item) => item.id === replyId) || null;

  if (!reply) {
    return null;
  }

  if (!canDeleteOwnedRecord(reply, clientState.auth.currentUser)) {
    throw new Error("无权删除该回复");
  }

  await apiRequest(`${config.apiBasePath}/${encodeURIComponent(reply.id)}`, {
    method: "DELETE",
  });

  updateClientState({
    detail: {
      [config.recordsKey]: clientState.detail[config.recordsKey].filter((item) => item.id !== reply.id),
      [config.selectedReplyKey]:
        clientState.detail[config.selectedReplyKey] === reply.id
          ? null
          : clientState.detail[config.selectedReplyKey],
    },
  });

  return reply;
}

function comparePapersForList(left, right) {
  const leftUploadTime = new Date(left.createdAt || left.created_at || 0).getTime();
  const rightUploadTime = new Date(right.createdAt || right.created_at || 0).getTime();
  const leftActivityTime = new Date(left.latestSpeechAt || leftUploadTime || 0).getTime();
  const rightActivityTime = new Date(right.latestSpeechAt || rightUploadTime || 0).getTime();

  if (rightActivityTime !== leftActivityTime) {
    return rightActivityTime - leftActivityTime;
  }

  if (rightUploadTime !== leftUploadTime) {
    return rightUploadTime - leftUploadTime;
  }

  return String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
}

function matchesPaperSearchTerm(paper, searchTerm) {
  const searchableValues = [
    paper?.title,
    paper?.authors,
    paper?.journal,
    paper?.abstract,
    ...(Array.isArray(paper?.keywords) ? paper.keywords : []),
    paper?.created_by_username,
  ];

  return searchableValues.some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(searchTerm)
  );
}

function resolveApiBaseUrl() {
  const queryApiBase = readApiBaseUrlFromQuery();

  if (queryApiBase) {
    return queryApiBase;
  }

  const storedApiBase = readApiBaseUrlFromStorage();

  if (storedApiBase) {
    return storedApiBase;
  }

  if (typeof window !== "undefined") {
    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      if (window.location.hostname) {
        return window.location.origin;
      }
    }
  }

  return DEFAULT_API_ORIGIN;
}

function readApiBaseUrlFromQuery() {
  try {
    if (typeof window === "undefined") {
      return "";
    }

    const params = new URLSearchParams(window.location.search || "");
    const rawValue = String(params.get("api") || "").trim();

    if (!rawValue) {
      return "";
    }

    return new URL(rawValue).toString().replace(/\/$/, "");
  } catch (error) {
    return "";
  }
}

function readApiBaseUrlFromStorage() {
  try {
    if (typeof window === "undefined") {
      return "";
    }

    const rawValue = String(window.localStorage.getItem(API_BASE_URL_STORAGE_KEY) || "").trim();

    if (!rawValue) {
      return "";
    }

    return new URL(rawValue).toString().replace(/\/$/, "");
  } catch (error) {
    return "";
  }
}

function readSessionToken() {
  try {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || "";
  } catch (error) {
    return "";
  }
}

function readStoredCurrentUser() {
  try {
    if (typeof window === "undefined") {
      return null;
    }

    const rawValue = window.localStorage.getItem(CURRENT_USER_STORAGE_KEY);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);

    if (!parsed || typeof parsed !== "object" || !String(parsed.id || "").trim()) {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
}

function persistSessionToken(token) {
  try {
    if (typeof window === "undefined") {
      return;
    }

    if (token) {
      window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, String(token));
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch (error) {
    // Ignore storage failures so the app can continue in private browsing mode.
  }
}

function persistCurrentUser(user) {
  try {
    if (typeof window === "undefined") {
      return;
    }

    if (user && typeof user === "object" && String(user.id || "").trim()) {
      window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    }
  } catch (error) {
    // Ignore storage failures so the app can continue with in-memory state.
  }
}

function clearPersistedSession() {
  persistSessionToken("");
  persistCurrentUser(null);
}

function defaultNavigateToUrl(url) {
  if (typeof window === "undefined") {
    return;
  }

  window.location.assign(url);
}

function isDetailPage() {
  return typeof document !== "undefined" && document.body?.dataset?.page === "detail";
}
