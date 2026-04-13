const CONTEXT_RADIUS = 40;
const DEFAULT_API_ORIGIN = "http://127.0.0.1:3000";
const API_BASE_URL_STORAGE_KEY = "papershare_api_base_url";
const APP_TITLE = "Yang Group文章分享讨论";
const SESSION_TOKEN_STORAGE_KEY = "papershare_session_token";
const CURRENT_USER_STORAGE_KEY = "papershare_current_user";
const LIBRARY_LAYOUT_STORAGE_KEY_PREFIX = "papershare_library_layout";
const {
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
  escapeHtml,
  extractAssignedJsonObject,
  getArticleImageSourceRule,
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  getUserRole,
  isAdminUser,
  isDiscussionReply,
  isReplyAnnotation,
  parsePreloadedStateFromHtml,
  safeParseHostname,
  stripBackgroundImagesFromInlineStyle,
  supportsArticleImagesForSourceUrl,
} = window.PaperShareShared;
const DEFAULT_LIBRARY_LAYOUT_RATIOS = Object.freeze({
  left: 0.264,
  right: 0.264,
});
const EMPTY_LIBRARY_LAYOUT_RATIOS = Object.freeze({
  left: null,
  right: null,
});
const DEFAULT_TWO_PANE_SIDE_RATIO = 0.95 / (1.7 + 0.95);
const API_BASE_URL = resolveApiBaseUrl();
const PAGE_TYPE = document.body?.dataset?.page || "catalog";
const IS_DETAIL_PAGE = PAGE_TYPE === "detail";
const IS_CATALOG_PAGE = PAGE_TYPE === "catalog";
const LIBRARY_INDEX_PATH = "./index.html";
const PAPER_DETAIL_PATH = "./paper.html";

const state = {
  isInitializing: true,
  serverReady: false,
  currentUser: readStoredCurrentUser(),
  currentView: "library",
  libraryPanel: "reader",
  profilePanel: "papers",
  memberProfilePanel: "papers",
  isLoggingIn: false,
  isUpdatingUsername: false,
  isChangingPassword: false,
  isCreatingUser: false,
  isManagingUser: false,
  managedUserActionUserId: "",
  managedUserActionType: "",
  loginStatus: "请输入账号密码",
  databaseStatus: "服务初始化中...",
  paperFormStatus: "等待抓取",
  usernameStatus: "请输入新的用户名",
  passwordStatus: "请输入当前密码和新密码",
  userManagementStatus: "管理员可以创建新的普通用户",
  papers: [],
  myUploadedPapers: [],
  myAnnotations: [],
  receivedReplies: [],
  allUsers: [],
  groupMembers: [],
  selectedMemberId: null,
  selectedMemberProfile: null,
  searchTerm: "",
  selectedPaperId: null,
  selectedPaper: null,
  articleLoaded: false,
  articleHtml: "",
  pendingSelection: null,
  selectedAnnotationId: null,
  selectedReplyId: null,
  annotationNavigationTargetId: null,
  annotations: [],
  selectedDiscussionId: null,
  selectedDiscussionReplyId: null,
  discussionNavigationTargetId: null,
  discussions: [],
  readerContextMenu: null,
  isSavingPaper: false,
  isSavingAnnotation: false,
  isSavingReply: false,
  isSavingDiscussion: false,
  isSavingDiscussionReply: false,
  annotationEditState: {
    targetId: null,
    targetType: "",
    draft: "",
    attachments: [],
    isSaving: false,
  },
  discussionEditState: {
    targetId: null,
    targetType: "",
    draft: "",
    attachments: [],
    isSaving: false,
  },
};

const pageTitle = document.querySelector("#page-title");
const pageSubtitle = document.querySelector("#page-subtitle");
const databaseStatus = document.querySelector("#database-status");
const authControls = document.querySelector("#auth-controls");
const currentUser = document.querySelector("#current-user");
const logoutButton = document.querySelector("#logout-button");
const paperFormStatus = document.querySelector("#paper-form-status");
const sourceLink = document.querySelector("#source-link");
const authGate = document.querySelector("#auth-gate");
const viewSwitcher = document.querySelector("#view-switcher");
const libraryViewButton = document.querySelector("#library-view-button");
const profileViewButton = document.querySelector("#profile-view-button");
const memberViewButton = document.querySelector("#member-view-button");
const libraryPanelReaderButton = document.querySelector("#library-panel-reader-button");
const libraryPanelDiscussionButton = document.querySelector("#library-panel-discussion-button");
const appContent = document.querySelector("#app-content");
const libraryView = document.querySelector("#library-view");
const profileView = document.querySelector("#profile-view");
const passwordView = document.querySelector("#password-view");
const userManagementView = document.querySelector("#user-management-view");
const membersView = document.querySelector("#members-view");
const leftPaneResizer = document.querySelector('[data-resizer="left"]');
const rightPaneResizer = document.querySelector('[data-resizer="right"]');
const loginForm = document.querySelector("#login-form");
const loginUsernameInput = document.querySelector("#login-username");
const loginPasswordInput = document.querySelector("#login-password");
const loginStatus = document.querySelector("#login-status");
const loginButton = document.querySelector("#login-button");

const paperForm = document.querySelector("#paper-form");
const paperSourceUrlInput = document.querySelector("#paper-source-url");
const paperRawHtmlInput = document.querySelector("#paper-raw-html");
const savePaperButton = document.querySelector("#save-paper-button");
const openSourceUrlButton = document.querySelector("#open-source-url-button");
const paperSearchInput = document.querySelector("#paper-search-input");
const paperCount = document.querySelector("#paper-count");
const paperList = document.querySelector("#paper-list");

const paperJournal = document.querySelector("#paper-journal");
const paperTitle = document.querySelector("#paper-title");
const paperAuthors = document.querySelector("#paper-authors");
const paperPublished = document.querySelector("#paper-published");
const paperOwner = document.querySelector("#paper-owner");
const paperAbstract = document.querySelector("#paper-abstract");
const paperKeywords = document.querySelector("#paper-keywords");
const deletePaperButton = document.querySelector("#delete-paper-button");
const librarySidebar = document.querySelector(".library-sidebar");
const paperColumn = document.querySelector(".paper-column");
const annotationRoot = document.querySelector("#annotation-root");
const articleRoot = document.querySelector("#article-root");
const annotationSidebar = document.querySelector(".sidebar");

const annotationInput = document.querySelector("#annotation-input");
const annotationAttachmentsInput = document.querySelector("#annotation-attachments");
const annotationAttachmentsPreview = document.querySelector("#annotation-attachments-preview");
const clearAnnotationAttachmentsButton = document.querySelector(
  "#clear-annotation-attachments-button"
);
const addAnnotationButton = document.querySelector("#add-annotation-button");
const cancelAnnotationButton = document.querySelector("#cancel-annotation-button");
const clearStorageButton = document.querySelector("#clear-storage-button");
const editAnnotationButton = document.querySelector("#edit-annotation-button");
const deleteAnnotationButton = document.querySelector("#delete-annotation-button");
const selectionStatus = document.querySelector("#selection-status");
const annotationDetail = document.querySelector("#annotation-detail");
const annotationDetailPanel = annotationDetail?.closest(".panel") || null;
const annotationList = document.querySelector("#annotation-list");
const annotationCount = document.querySelector("#annotation-count");
const readerContextMenu = document.querySelector("#reader-context-menu");
const replyContext = document.querySelector("#reply-context");
const replyInput = document.querySelector("#reply-input");
const replyAttachmentsInput = document.querySelector("#reply-attachments");
const replyAttachmentsPreview = document.querySelector("#reply-attachments-preview");
const clearReplyAttachmentsButton = document.querySelector("#clear-reply-attachments-button");
const addReplyButton = document.querySelector("#add-reply-button");
const discussionBoard = document.querySelector("#discussion-board");
const discussionStatus = document.querySelector("#discussion-status");
const discussionInput = document.querySelector("#discussion-input");
const discussionAttachmentsInput = document.querySelector("#discussion-attachments");
const discussionAttachmentsPreview = document.querySelector("#discussion-attachments-preview");
const clearDiscussionAttachmentsButton = document.querySelector(
  "#clear-discussion-attachments-button"
);
const addDiscussionButton = document.querySelector("#add-discussion-button");
const cancelDiscussionButton = document.querySelector("#cancel-discussion-button");
const editDiscussionButton = document.querySelector("#edit-discussion-button");
const deleteDiscussionButton = document.querySelector("#delete-discussion-button");
const discussionDetail = document.querySelector("#discussion-detail");
const discussionDetailPanel = discussionDetail?.closest(".panel") || null;
const discussionList = document.querySelector("#discussion-list");
const discussionCount = document.querySelector("#discussion-count");
const discussionReplyContext = document.querySelector("#discussion-reply-context");
const discussionReplyInput = document.querySelector("#discussion-reply-input");
const discussionReplyAttachmentsInput = document.querySelector("#discussion-reply-attachments");
const discussionReplyAttachmentsPreview = document.querySelector(
  "#discussion-reply-attachments-preview"
);
const clearDiscussionReplyAttachmentsButton = document.querySelector(
  "#clear-discussion-reply-attachments-button"
);
const attachmentComposerConfigs = [
  {
    input: annotationAttachmentsInput,
    preview: annotationAttachmentsPreview,
    clearButton: clearAnnotationAttachmentsButton,
  },
  {
    input: replyAttachmentsInput,
    preview: replyAttachmentsPreview,
    clearButton: clearReplyAttachmentsButton,
  },
  {
    input: discussionAttachmentsInput,
    preview: discussionAttachmentsPreview,
    clearButton: clearDiscussionAttachmentsButton,
  },
  {
    input: discussionReplyAttachmentsInput,
    preview: discussionReplyAttachmentsPreview,
    clearButton: clearDiscussionReplyAttachmentsButton,
  },
];
const addDiscussionReplyButton = document.querySelector("#add-discussion-reply-button");
const profileStats = document.querySelector("#profile-stats");
const profileSummary = document.querySelector("#profile-summary");
const accountSettingsButton = document.querySelector("#account-settings-button");
const userManagementButton = document.querySelector("#user-management-button");
const usernameStatus = document.querySelector("#username-status");
const usernameForm = document.querySelector("#username-form");
const currentUsernameInput = document.querySelector("#current-username");
const nextUsernameInput = document.querySelector("#next-username");
const changeUsernameButton = document.querySelector("#change-username-button");
const passwordStatus = document.querySelector("#password-status");
const passwordForm = document.querySelector("#password-form");
const passwordBackButton = document.querySelector("#password-back-button");
const currentPasswordInput = document.querySelector("#current-password");
const nextPasswordInput = document.querySelector("#next-password");
const confirmPasswordInput = document.querySelector("#confirm-password");
const changePasswordButton = document.querySelector("#change-password-button");
const userManagementBackButton = document.querySelector("#user-management-back-button");
const userManagementStatus = document.querySelector("#user-management-status");
const createUserForm = document.querySelector("#create-user-form");
const createUserUsernameInput = document.querySelector("#create-user-username");
const createUserPasswordInput = document.querySelector("#create-user-password");
const createUserConfirmPasswordInput = document.querySelector("#create-user-confirm-password");
const createUserButton = document.querySelector("#create-user-button");
const managedUserCount = document.querySelector("#managed-user-count");
const managedUserList = document.querySelector("#managed-user-list");
const myPaperCount = document.querySelector("#my-paper-count");
const myPaperList = document.querySelector("#my-paper-list");
const myAnnotationCount = document.querySelector("#my-annotation-count");
const myAnnotationList = document.querySelector("#my-annotation-list");
const receivedReplyCount = document.querySelector("#received-reply-count");
const receivedReplyList = document.querySelector("#received-reply-list");
const profilePanelPapersButton = document.querySelector("#profile-panel-papers-button");
const profilePanelSpeechesButton = document.querySelector("#profile-panel-speeches-button");
const profilePanelRepliesButton = document.querySelector("#profile-panel-replies-button");
const profilePanelPapers = document.querySelector("#profile-panel-papers");
const profilePanelSpeeches = document.querySelector("#profile-panel-speeches");
const profilePanelReplies = document.querySelector("#profile-panel-replies");
const memberCount = document.querySelector("#member-count");
const memberList = document.querySelector("#member-list");
const memberProfileStats = document.querySelector("#member-profile-stats");
const memberProfileSummary = document.querySelector("#member-profile-summary");
const memberProfilePapersButton = document.querySelector("#member-profile-papers-button");
const memberProfileSpeechesButton = document.querySelector("#member-profile-speeches-button");
const memberProfilePaperCount = document.querySelector("#member-profile-paper-count");
const memberProfileAnnotationCount = document.querySelector("#member-profile-annotation-count");
const memberProfilePapers = document.querySelector("#member-profile-papers");
const memberProfileSpeeches = document.querySelector("#member-profile-speeches");
const memberProfilePaperList = document.querySelector("#member-profile-paper-list");
const memberProfileAnnotationList = document.querySelector("#member-profile-annotation-list");
const backToLibraryButton = document.querySelector("#back-to-library-button");
const desktopScrollPanes = [
  document.querySelector(".library-sidebar"),
  document.querySelector(".library-search"),
  document.querySelector(".paper-column"),
  document.querySelector(".sidebar"),
  discussionBoard,
  profileView,
  passwordView,
  userManagementView,
  membersView,
];
let sessionToken = readSessionToken();
let scrollLayoutFrame = 0;
const composerAttachmentFiles = new WeakMap();
const libraryPaneLayout = {
  ratios: IS_DETAIL_PAGE ? { ...EMPTY_LIBRARY_LAYOUT_RATIOS } : readLibraryLayoutRatios(),
  activeHandle: "",
  dragStartX: 0,
  dragStartWidths: null,
};

bindEvents();
initialize();

async function initialize() {
  render();

  try {
    state.serverReady = true;
    const authState = await apiRequest("/api/auth/me");

    if (authState.authenticated && authState.user) {
      state.currentUser = authState.user;
      storeCurrentUser(authState.user);
      state.loginStatus = `已登录为 ${authState.user.username}`;
      await initializeAuthenticatedApp();
    } else {
      clearStoredCurrentUser();
      state.currentUser = null;
      state.databaseStatus = "服务已连接，请先登录";
      state.paperFormStatus = "登录后可抓取文献";
    }
  } catch (error) {
    console.error("Failed to initialize app.", error);
    state.databaseStatus = `服务未启动（API: ${API_BASE_URL}）`;
    state.paperFormStatus = "请先启动 server.js";
    state.loginStatus = "无法连接服务";
  } finally {
    state.isInitializing = false;
  }

  render();
}

function bindEvents() {
  window.addEventListener("hashchange", handleHashChange);
  window.addEventListener("resize", queueScrollPaneLayout);
  window.addEventListener("pointermove", handleLibraryPaneResizePointerMove);
  window.addEventListener("pointerup", finishLibraryPaneResize);
  window.addEventListener("pointercancel", finishLibraryPaneResize);
  loginForm?.addEventListener("submit", handleLoginSubmit);
  logoutButton?.addEventListener("click", handleLogout);
  libraryViewButton?.addEventListener("click", () => switchView("library"));
  profileViewButton?.addEventListener("click", () => switchView("profile"));
  memberViewButton?.addEventListener("click", () => switchView("members"));
  libraryPanelReaderButton?.addEventListener("click", () => switchLibraryPanel("reader"));
  libraryPanelDiscussionButton?.addEventListener("click", () => switchLibraryPanel("discussion"));
  accountSettingsButton?.addEventListener("click", () => switchView("password"));
  userManagementButton?.addEventListener("click", () => switchView("user-management"));
  usernameForm?.addEventListener("submit", handleUsernameSubmit);
  passwordBackButton?.addEventListener("click", handlePasswordBackClick);
  userManagementBackButton?.addEventListener("click", handleUserManagementBackClick);
  paperForm?.addEventListener("submit", handlePaperSubmit);
  paperSourceUrlInput?.addEventListener("input", render);
  paperRawHtmlInput?.addEventListener("input", render);
  openSourceUrlButton?.addEventListener("click", handleOpenSourceUrlClick);
  deletePaperButton?.addEventListener("click", handleDeletePaper);
  paperSearchInput?.addEventListener("input", handlePaperSearchInput);
  paperList?.addEventListener("click", handlePaperListClick);
  paperList?.addEventListener("contextmenu", handlePaperListContextMenu);
  addAnnotationButton?.addEventListener("click", handleAddAnnotation);
  cancelAnnotationButton?.addEventListener("click", handleCancelPendingAnnotation);
  editAnnotationButton?.addEventListener("click", handleEditAnnotation);
  deleteAnnotationButton?.addEventListener("click", handleDeleteAnnotation);
  clearStorageButton?.addEventListener("click", handleClearAnnotations);
  annotationRoot?.addEventListener("click", handleHighlightClick);
  annotationRoot?.addEventListener("contextmenu", handleReaderContextMenuOpen);
  annotationList?.addEventListener("click", handleAnnotationListClick);
  annotationDetail?.addEventListener("click", handleAnnotationDetailClick);
  annotationDetail?.addEventListener("change", handleAnnotationDetailChange);
  readerContextMenu?.addEventListener("click", handleReaderContextMenuClick);
  addReplyButton?.addEventListener("click", handleAddReply);
  addDiscussionButton?.addEventListener("click", handleAddDiscussion);
  cancelDiscussionButton?.addEventListener("click", handleCancelDiscussion);
  editDiscussionButton?.addEventListener("click", handleEditDiscussion);
  deleteDiscussionButton?.addEventListener("click", handleDeleteDiscussion);
  discussionList?.addEventListener("click", handleDiscussionListClick);
  discussionDetail?.addEventListener("click", handleDiscussionDetailClick);
  discussionDetail?.addEventListener("change", handleDiscussionDetailChange);
  addDiscussionReplyButton?.addEventListener("click", handleAddDiscussionReply);
  passwordForm?.addEventListener("submit", handlePasswordSubmit);
  createUserForm?.addEventListener("submit", handleCreateUserSubmit);
  managedUserList?.addEventListener("click", handleManagedUserListClick);
  profilePanelPapersButton?.addEventListener("click", () => switchProfilePanel("papers"));
  profilePanelSpeechesButton?.addEventListener("click", () => switchProfilePanel("speeches"));
  profilePanelRepliesButton?.addEventListener("click", () => switchProfilePanel("replies"));
  memberProfilePapersButton?.addEventListener("click", () => switchMemberProfilePanel("papers"));
  memberProfileSpeechesButton?.addEventListener("click", () => switchMemberProfilePanel("speeches"));
  myPaperList?.addEventListener("click", handleMyPaperListClick);
  myAnnotationList?.addEventListener("click", handleMyAnnotationListClick);
  receivedReplyList?.addEventListener("click", handleReceivedReplyListClick);
  memberList?.addEventListener("click", handleMemberListClick);
  memberProfilePaperList?.addEventListener("click", handleMemberProfilePaperListClick);
  memberProfileAnnotationList?.addEventListener("click", handleMemberProfileAnnotationListClick);
  annotationInput?.addEventListener("pointerdown", capturePendingSelectionForComposer);
  annotationInput?.addEventListener("focus", capturePendingSelectionForComposer);
  annotationInput?.addEventListener("focus", syncComposerTextareaState);
  annotationInput?.addEventListener("blur", syncComposerTextareaState);
  annotationInput?.addEventListener("input", syncComposerTextareaState);
  replyInput?.addEventListener("focus", syncComposerTextareaState);
  replyInput?.addEventListener("blur", syncComposerTextareaState);
  replyInput?.addEventListener("input", syncComposerTextareaState);
  discussionInput?.addEventListener("focus", syncComposerTextareaState);
  discussionInput?.addEventListener("blur", syncComposerTextareaState);
  discussionInput?.addEventListener("input", handleDiscussionInputChange);
  discussionReplyInput?.addEventListener("focus", syncComposerTextareaState);
  discussionReplyInput?.addEventListener("blur", syncComposerTextareaState);
  discussionReplyInput?.addEventListener("input", syncComposerTextareaState);
  backToLibraryButton?.addEventListener("click", handleBackToLibrary);

  for (const handle of [leftPaneResizer, rightPaneResizer]) {
    if (!handle) {
      continue;
    }

    handle.addEventListener("pointerdown", handleLibraryPaneResizePointerDown);
    handle.addEventListener("keydown", handleLibraryPaneResizeKeyDown);
  }

  document.addEventListener("pointerdown", handleGlobalPointerDown, true);
  document.addEventListener("keydown", handleGlobalKeyDown);
  window.addEventListener("resize", handleGlobalViewportChange);
  window.addEventListener("scroll", handleGlobalViewportChange, true);
  window.addEventListener("blur", handleGlobalViewportChange);

  for (const { input, preview, clearButton } of attachmentComposerConfigs) {
    input?.addEventListener("change", handleAttachmentInputChange);
    preview?.addEventListener("click", handleAttachmentPreviewClick);
    clearButton?.addEventListener("click", () => clearComposerAttachments(input));
  }
}

function render() {
  renderAuth();
  renderHeader();

  if (state.isInitializing) {
    return;
  }

  renderViewSwitcher();
  renderViews();
  renderLibraryPanels();
  renderPaperForm();
  renderPaperList();
  renderPaperMeta();
  renderArticle();
  renderSelectionPanel();
  renderReaderContextMenu();
  renderAnnotationList();
  renderAnnotationDetail();
  renderReplyComposer();
  renderDiscussionComposer();
  renderDiscussionList();
  renderDiscussionDetail();
  renderDiscussionReplyComposer();
  renderComposerAttachments();
  renderProfileSummary();
  renderAccountSettings();
  renderProfilePanels();
  renderMyPaperList();
  renderMyAnnotationList();
  renderReceivedReplyList();
  renderUserManagement();
  renderMemberList();
  renderMemberProfileSummary();
  renderMemberProfilePanels();
  renderMemberProfilePaperList();
  renderMemberProfileAnnotationList();
  if (annotationInput) {
    syncComposerTextareaState({ currentTarget: annotationInput });
  }
  if (replyInput) {
    syncComposerTextareaState({ currentTarget: replyInput });
  }
  if (discussionInput) {
    syncComposerTextareaState({ currentTarget: discussionInput });
  }
  if (discussionReplyInput) {
    syncComposerTextareaState({ currentTarget: discussionReplyInput });
  }
  flushPendingAnnotationNavigation();
  flushPendingDiscussionNavigation();
  queueScrollPaneLayout();
}

function renderComposerAttachments() {
  for (const config of attachmentComposerConfigs) {
    renderAttachmentComposerState(config);
  }
}

function renderAttachmentComposerState({ input, preview, clearButton }) {
  if (!input || !preview || !clearButton) {
    return;
  }

  const files = getAttachmentFiles(input);

  clearButton.disabled = input.disabled || files.length === 0;
  clearButton.classList.toggle("is-hidden", files.length === 0);

  if (!files.length) {
    preview.className = "composer-attachment-preview empty-state";
    preview.textContent = "还没有选择附件。";
    return;
  }

  preview.className = "composer-attachment-preview";
  preview.innerHTML = files
    .map((file, index) => {
      const categoryLabel = getAttachmentCategoryLabel(file);
      return `
        <article class="composer-attachment-chip">
          <div class="composer-attachment-chip-body">
            <strong>${escapeHtml(file.name || "未命名附件")}</strong>
            <span>${escapeHtml(categoryLabel)} · ${escapeHtml(formatFileSize(file.size || 0))}</span>
          </div>
          <button
            class="ghost-button composer-attachment-remove"
            type="button"
            data-remove-attachment-index="${index}"
            ${input.disabled ? "disabled" : ""}
          >
            删除
          </button>
        </article>
      `;
    })
    .join("");
}

function renderDetailEditAttachments(kind, editState) {
  const attachments = getEditableAttachmentItems(editState);
  const isSaving = Boolean(editState?.isSaving);
  const kindLabel = kind === "discussion" ? "讨论" : "批注";
  const previewClassName = attachments.length
    ? "composer-attachment-preview"
    : "composer-attachment-preview empty-state";

  return `
    <div class="attachment-composer">
      <label class="field">
        <span>附件（支持图片与表格，可多选）</span>
        <input
          id="${kind}-detail-attachments"
          type="file"
          accept="${ATTACHMENT_INPUT_ACCEPT}"
          multiple
          ${isSaving ? "disabled" : ""}
        />
      </label>
      <div class="attachment-composer-actions">
        <p class="panel-tip attachment-tip">可删除旧附件，也可继续补充新附件。</p>
        <button
          class="ghost-button ${attachments.length ? "" : "is-hidden"}"
          type="button"
          data-clear-${kind}-edit-attachments="true"
          ${isSaving || attachments.length === 0 ? "disabled" : ""}
        >
          清空附件
        </button>
      </div>
      <div class="${previewClassName}">
        ${
          attachments.length
            ? attachments
                .map((item) => renderDetailEditAttachmentChip(kind, item, isSaving))
                .join("")
            : `还没有为这条${kindLabel}保留或选择附件。`
        }
      </div>
    </div>
  `;
}

function renderDetailEditAttachmentChip(kind, item, isSaving) {
  const attachmentSource = item.kind === "existing" ? item.attachment : item.file;
  const sourceLabel = item.kind === "existing" ? "已保存" : "待上传";

  return `
    <article class="composer-attachment-chip">
      <div class="composer-attachment-chip-body">
        <strong>${escapeHtml(
          attachmentSource?.original_name || attachmentSource?.filename || attachmentSource?.name || "未命名附件"
        )}</strong>
        <span>${escapeHtml(
          `${getAttachmentCategoryLabel(attachmentSource)} · ${formatFileSize(
            attachmentSource?.size_bytes || attachmentSource?.size || 0
          )} · ${sourceLabel}`
        )}</span>
      </div>
      <button
        class="ghost-button composer-attachment-remove"
        type="button"
        data-remove-${kind}-edit-attachment-key="${escapeHtml(item.key)}"
        ${isSaving ? "disabled" : ""}
      >
        删除
      </button>
    </article>
  `;
}

function queueScrollPaneLayout() {
  if (scrollLayoutFrame) {
    window.cancelAnimationFrame(scrollLayoutFrame);
  }

  scrollLayoutFrame = window.requestAnimationFrame(() => {
    scrollLayoutFrame = 0;
    syncLibraryPaneLayout();
    syncScrollPaneLayout();
  });
}

function syncLibraryPaneLayout() {
  if (!libraryView || libraryView.classList.contains("is-hidden")) {
    return;
  }

  if (!hasCustomLibraryPaneLayout(libraryPaneLayout.ratios)) {
    clearLibraryPaneTrackStyles();
    return;
  }

  const metrics = getLibraryPaneMetrics();

  if (!metrics) {
    clearLibraryPaneTrackStyles();
    return;
  }

  const widths = resolveLibraryPaneWidths(metrics, libraryPaneLayout.ratios);
  applyLibraryPaneWidths(widths);
}

function getLibraryPaneMetrics() {
  if (!isResizableLibraryViewport()) {
    return null;
  }

  const totalWidth = libraryView.clientWidth;

  if (!totalWidth) {
    return null;
  }

  const hasLeftPane = Boolean(librarySidebar);
  const hasRightPane = Boolean(annotationSidebar);
  const handleCount = Number(Boolean(leftPaneResizer)) + Number(Boolean(rightPaneResizer));
  const gapCount = handleCount ? handleCount * 2 : 0;
  const computedStyle = window.getComputedStyle(libraryView);
  const handleSize = parseFloat(computedStyle.getPropertyValue("--pane-resizer-size")) || 12;
  const columnGap = parseFloat(computedStyle.columnGap || computedStyle.gap) || 0;
  const leftMin = hasLeftPane
    ? parseFloat(computedStyle.getPropertyValue("--library-left-min")) || 280
    : 0;
  const centerMin = parseFloat(computedStyle.getPropertyValue("--library-center-min")) || 360;
  const rightMin = hasRightPane
    ? parseFloat(computedStyle.getPropertyValue("--library-right-min")) || 280
    : 0;
  const availableWidth = Math.max(
    totalWidth - handleSize * handleCount - columnGap * gapCount,
    0
  );

  if (!availableWidth) {
    return null;
  }

  return {
    totalWidth,
    availableWidth,
    handleSize,
    columnGap,
    leftMin,
    centerMin,
    rightMin,
    hasLeftPane,
    hasRightPane,
  };
}

function resolveLibraryPaneWidths(metrics, ratios = DEFAULT_LIBRARY_LAYOUT_RATIOS) {
  const minimumContentWidth = metrics.leftMin + metrics.centerMin + metrics.rightMin;
  const hasLeftPane = metrics.hasLeftPane;
  const hasRightPane = metrics.hasRightPane;
  const leftRatio = Number.isFinite(ratios?.left) ? ratios.left : DEFAULT_LIBRARY_LAYOUT_RATIOS.left;
  const rightRatio = Number.isFinite(ratios?.right)
    ? ratios.right
    : DEFAULT_LIBRARY_LAYOUT_RATIOS.right;

  if (metrics.availableWidth <= minimumContentWidth) {
    const scale = metrics.availableWidth / minimumContentWidth;
    const left = Math.floor(metrics.leftMin * scale);
    const center = Math.floor(metrics.centerMin * scale);
    const right = Math.max(metrics.availableWidth - left - center, 0);
    return { left, center, right };
  }

  if (!hasLeftPane && hasRightPane) {
    const right = clamp(
      Math.round(metrics.availableWidth * rightRatioForLayout(rightRatio)),
      metrics.rightMin,
      metrics.availableWidth - metrics.centerMin
    );
    return {
      left: 0,
      center: metrics.availableWidth - right,
      right,
    };
  }

  if (hasLeftPane && !hasRightPane) {
    const left = clamp(
      Math.round(metrics.availableWidth * leftRatioForLayout(leftRatio)),
      metrics.leftMin,
      metrics.availableWidth - metrics.centerMin
    );
    return {
      left,
      center: metrics.availableWidth - left,
      right: 0,
    };
  }

  let left = clamp(
    Math.round(metrics.availableWidth * leftRatio),
    metrics.leftMin,
    metrics.availableWidth - metrics.centerMin - metrics.rightMin
  );
  let right = clamp(
    Math.round(metrics.availableWidth * rightRatio),
    metrics.rightMin,
    metrics.availableWidth - metrics.centerMin - left
  );
  let center = metrics.availableWidth - left - right;

  if (center < metrics.centerMin) {
    const deficit = metrics.centerMin - center;
    const reducibleLeft = Math.max(left - metrics.leftMin, 0);
    const leftReduction = Math.min(Math.ceil(deficit / 2), reducibleLeft);
    left -= leftReduction;
    center += leftReduction;

    if (center < metrics.centerMin) {
      const reducibleRight = Math.max(right - metrics.rightMin, 0);
      const rightReduction = Math.min(metrics.centerMin - center, reducibleRight);
      right -= rightReduction;
      center += rightReduction;
    }
  }

  return {
    left,
    center,
    right,
  };
}

function applyLibraryPaneWidths(widths) {
  libraryView.style.setProperty("--library-left-track", `${widths.left}px`);
  libraryView.style.setProperty("--library-center-track", `${widths.center}px`);
  libraryView.style.setProperty("--library-right-track", `${widths.right}px`);
  syncLibraryPaneResizeAria(widths);
}

function clearLibraryPaneTrackStyles() {
  libraryView.style.removeProperty("--library-left-track");
  libraryView.style.removeProperty("--library-center-track");
  libraryView.style.removeProperty("--library-right-track");
  syncLibraryPaneResizeAria();
}

function handleLibraryPaneResizePointerDown(event) {
  if (!isResizableLibraryViewport() || event.button !== 0) {
    return;
  }

  const handle = event.currentTarget;
  const handleName = handle?.dataset?.resizer;
  const metrics = getLibraryPaneMetrics();

  if (!handleName || !metrics) {
    return;
  }

  event.preventDefault();
  libraryPaneLayout.activeHandle = handleName;
  libraryPaneLayout.dragStartX = event.clientX;
  libraryPaneLayout.dragStartWidths = resolveLibraryPaneWidths(metrics, libraryPaneLayout.ratios);
  handle.classList.add("is-active");
  handle.setPointerCapture?.(event.pointerId);
}

function handleLibraryPaneResizePointerMove(event) {
  if (!libraryPaneLayout.activeHandle) {
    return;
  }

  const metrics = getLibraryPaneMetrics();

  if (!metrics) {
    finishLibraryPaneResize();
    return;
  }

  const currentWidths =
    libraryPaneLayout.dragStartWidths || resolveLibraryPaneWidths(metrics, libraryPaneLayout.ratios);
  const deltaX = event.clientX - libraryPaneLayout.dragStartX;
  const isCatalogLayout =
    libraryPaneLayout.activeHandle === "left" &&
    libraryView?.classList.contains("is-catalog") &&
    !metrics.hasRightPane;
  let nextWidths = currentWidths;

  if (libraryPaneLayout.activeHandle === "left") {
    const nextLeft = clamp(
      Math.round(currentWidths.left + (isCatalogLayout ? -deltaX : deltaX)),
      metrics.leftMin,
      metrics.availableWidth - currentWidths.right - metrics.centerMin
    );
    nextWidths = {
      left: nextLeft,
      center: metrics.availableWidth - nextLeft - currentWidths.right,
      right: currentWidths.right,
    };
  }

  if (libraryPaneLayout.activeHandle === "right") {
    const nextRight = clamp(
      Math.round(currentWidths.right - deltaX),
      metrics.rightMin,
      metrics.availableWidth - currentWidths.left - metrics.centerMin
    );
    nextWidths = {
      left: currentWidths.left,
      center: metrics.availableWidth - currentWidths.left - nextRight,
      right: nextRight,
    };
  }

  libraryPaneLayout.ratios = {
    left: nextWidths.left / metrics.availableWidth,
    right: nextWidths.right / metrics.availableWidth,
  };
  storeLibraryLayoutRatios(libraryPaneLayout.ratios);
  applyLibraryPaneWidths(nextWidths);
  queueScrollPaneLayout();
}

function finishLibraryPaneResize() {
  if (!libraryPaneLayout.activeHandle) {
    return;
  }

  const activeHandle =
    libraryPaneLayout.activeHandle === "left" ? leftPaneResizer : rightPaneResizer;

  activeHandle?.classList.remove("is-active");
  libraryPaneLayout.activeHandle = "";
  libraryPaneLayout.dragStartX = 0;
  libraryPaneLayout.dragStartWidths = null;
}

function handleLibraryPaneResizeKeyDown(event) {
  if (!isResizableLibraryViewport()) {
    return;
  }

  const step = event.shiftKey ? 48 : 24;
  const direction =
    event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;

  if (!direction) {
    return;
  }

  const metrics = getLibraryPaneMetrics();

  if (!metrics) {
    return;
  }

  event.preventDefault();

  const handleName = event.currentTarget?.dataset?.resizer;
  const currentWidths = resolveLibraryPaneWidths(metrics, libraryPaneLayout.ratios);
  const isCatalogLayout =
    handleName === "left" && libraryView?.classList.contains("is-catalog") && !metrics.hasRightPane;
  const adjustedDirection = isCatalogLayout ? -direction : direction;
  let nextWidths = currentWidths;

  if (handleName === "left") {
    const nextLeft = clamp(
      currentWidths.left + adjustedDirection * step,
      metrics.leftMin,
      metrics.availableWidth - currentWidths.right - metrics.centerMin
    );
    nextWidths = {
      left: nextLeft,
      center: metrics.availableWidth - nextLeft - currentWidths.right,
      right: currentWidths.right,
    };
  }

  if (handleName === "right") {
    const nextRight = clamp(
      currentWidths.right - direction * step,
      metrics.rightMin,
      metrics.availableWidth - currentWidths.left - metrics.centerMin
    );
    nextWidths = {
      left: currentWidths.left,
      center: metrics.availableWidth - currentWidths.left - nextRight,
      right: nextRight,
    };
  }

  libraryPaneLayout.ratios = {
    left: nextWidths.left / metrics.availableWidth,
    right: nextWidths.right / metrics.availableWidth,
  };
  storeLibraryLayoutRatios(libraryPaneLayout.ratios);
  applyLibraryPaneWidths(nextWidths);
  queueScrollPaneLayout();
}

function syncLibraryPaneResizeAria(widths) {
  const metrics = getLibraryPaneMetrics();

  if (!metrics) {
    for (const handle of [leftPaneResizer, rightPaneResizer]) {
      if (!handle) {
        continue;
      }

      handle.removeAttribute("aria-valuemin");
      handle.removeAttribute("aria-valuemax");
      handle.removeAttribute("aria-valuenow");
    }

    return;
  }

  const currentWidths = widths || resolveLibraryPaneWidths(metrics, libraryPaneLayout.ratios);
  const isCatalogLayout =
    libraryView?.classList.contains("is-catalog") && !metrics.hasRightPane;

  if (leftPaneResizer) {
    leftPaneResizer.setAttribute("role", "separator");
    leftPaneResizer.setAttribute(
      "aria-valuemin",
      String(Math.round(isCatalogLayout ? metrics.centerMin : metrics.leftMin))
    );
    leftPaneResizer.setAttribute(
      "aria-valuemax",
      String(
        Math.round(
          isCatalogLayout
            ? metrics.availableWidth - metrics.leftMin
            : metrics.availableWidth - currentWidths.right - metrics.centerMin
        )
      )
    );
    leftPaneResizer.setAttribute(
      "aria-valuenow",
      String(Math.round(isCatalogLayout ? currentWidths.center : currentWidths.left))
    );
  }

  if (rightPaneResizer) {
    rightPaneResizer.setAttribute("role", "separator");
    rightPaneResizer.setAttribute("aria-valuemin", String(Math.round(metrics.rightMin)));
    rightPaneResizer.setAttribute(
      "aria-valuemax",
      String(Math.round(metrics.availableWidth - currentWidths.left - metrics.centerMin))
    );
    rightPaneResizer.setAttribute("aria-valuenow", String(Math.round(currentWidths.right)));
  }
}

function isResizableLibraryViewport() {
  return window.matchMedia("(min-width: 1281px)").matches;
}

function syncScrollPaneLayout() {
  const isDesktopViewport = window.matchMedia("(min-width: 981px)").matches;

  for (const pane of desktopScrollPanes) {
    if (!pane) {
      continue;
    }

    if (!isDesktopViewport || pane.classList.contains("is-hidden")) {
      pane.style.maxHeight = "";
      continue;
    }

    const viewportTopGap = 24;
    const viewportBottomGap = 24;
    const paneTop = Math.max(pane.getBoundingClientRect().top, viewportTopGap);
    const availableHeight = Math.floor(window.innerHeight - paneTop - viewportBottomGap);

    pane.style.maxHeight = availableHeight > 240 ? `${availableHeight}px` : "";
  }
}

function renderAuth() {
  const isAuthenticated = Boolean(state.currentUser);
  const isInitializing = state.isInitializing;

  authGate?.classList.toggle("is-hidden", isAuthenticated || isInitializing);
  appContent?.classList.toggle("is-hidden", !isAuthenticated || isInitializing);
  viewSwitcher?.classList.toggle("is-hidden", !isAuthenticated || isInitializing);
  authControls?.classList.toggle("is-hidden", !isAuthenticated || isInitializing);
  if (currentUser) {
    currentUser.textContent = isAuthenticated ? `当前用户：${formatUserBadge(state.currentUser)}` : "";
  }
  if (loginStatus) {
    loginStatus.textContent = isInitializing ? "正在恢复登录状态..." : state.loginStatus;
  }
  if (loginButton) {
    loginButton.disabled = isInitializing || !state.serverReady || state.isLoggingIn;
  }
}

function renderViewSwitcher() {
  libraryViewButton?.classList.toggle("active", state.currentView === "library");
  profileViewButton?.classList.toggle("active", state.currentView === "profile");
  memberViewButton?.classList.toggle("active", state.currentView === "members");
}

function renderViews() {
  libraryView?.classList.toggle("is-hidden", state.currentView !== "library");
  profileView?.classList.toggle("is-hidden", state.currentView !== "profile");
  passwordView?.classList.toggle("is-hidden", state.currentView !== "password");
  userManagementView?.classList.toggle("is-hidden", state.currentView !== "user-management");
  membersView?.classList.toggle("is-hidden", state.currentView !== "members");
}

function renderLibraryPanels() {
  const isLibraryView = state.currentView === "library";
  const isReaderPanel = state.libraryPanel !== "discussion";

  libraryPanelReaderButton?.classList.toggle("active", isReaderPanel);
  libraryPanelReaderButton?.setAttribute("aria-selected", String(isReaderPanel));
  libraryPanelDiscussionButton?.classList.toggle("active", !isReaderPanel);
  libraryPanelDiscussionButton?.setAttribute("aria-selected", String(!isReaderPanel));

  const showReader = isLibraryView && isReaderPanel;
  const showDiscussion = isLibraryView && !isReaderPanel;

  paperColumn?.classList.toggle("is-hidden", !showReader);
  rightPaneResizer?.classList.toggle("is-hidden", !showReader);
  annotationSidebar?.classList.toggle("is-hidden", !showReader);
  discussionBoard?.classList.toggle("is-hidden", !showDiscussion);
}

function renderHeader() {
  if (databaseStatus) {
    databaseStatus.textContent = state.databaseStatus;
  }

  if (!state.currentUser) {
    if (pageTitle) {
      pageTitle.textContent = APP_TITLE;
    }
    if (pageSubtitle) {
      pageSubtitle.innerHTML = "登录后才能查看文献与批注";
    }
    if (sourceLink) {
      sourceLink.href = "#";
      sourceLink.classList.add("is-disabled");
      sourceLink.setAttribute("aria-disabled", "true");
    }
    return;
  }

  if (state.currentView === "profile") {
    if (pageTitle) {
      pageTitle.textContent = APP_TITLE;
    }
    if (pageSubtitle) {
      pageSubtitle.innerHTML = "";
    }
    if (sourceLink) {
      sourceLink.href = "#";
      sourceLink.classList.add("is-disabled");
      sourceLink.setAttribute("aria-disabled", "true");
    }
    return;
  }

  if (state.currentView === "password") {
    if (pageTitle) {
      pageTitle.textContent = APP_TITLE;
    }
    if (pageSubtitle) {
      pageSubtitle.innerHTML = "可在这里修改当前账号的用户名和登录密码，并可返回个人中心。";
    }
    if (sourceLink) {
      sourceLink.href = "#";
      sourceLink.classList.add("is-disabled");
      sourceLink.setAttribute("aria-disabled", "true");
    }
    return;
  }

  if (state.currentView === "user-management") {
    if (pageTitle) {
      pageTitle.textContent = APP_TITLE;
    }
    if (pageSubtitle) {
      pageSubtitle.innerHTML = isCurrentUserAdmin()
        ? "管理员可在这里创建新的普通用户，并查看当前用户列表。"
        : "只有管理员可以访问用户管理。";
    }
    if (sourceLink) {
      sourceLink.href = "#";
      sourceLink.classList.add("is-disabled");
      sourceLink.setAttribute("aria-disabled", "true");
    }
    return;
  }

  if (state.currentView === "members") {
    const selectedMember =
      state.selectedMemberProfile?.user ||
      state.groupMembers.find((member) => member.id === state.selectedMemberId) ||
      null;
    if (pageTitle) {
      pageTitle.textContent = APP_TITLE;
    }
    if (pageSubtitle) {
      pageSubtitle.innerHTML = selectedMember
        ? `当前正在查看 <code>${escapeHtml(selectedMember.username)}</code> 的主页。`
        : "点击成员列表中的用户，可查看对方主页与历史发言。";
    }
    if (sourceLink) {
      sourceLink.href = "#";
      sourceLink.classList.add("is-disabled");
      sourceLink.setAttribute("aria-disabled", "true");
    }
    return;
  }

  if (!state.selectedPaper) {
    if (pageTitle) {
      pageTitle.textContent = APP_TITLE;
    }
    if (pageSubtitle) {
      pageSubtitle.innerHTML = `目前共管理 <code>${state.papers.length}</code> 篇文献。`;
    }
    if (sourceLink) {
      sourceLink.href = "#";
      sourceLink.classList.add("is-disabled");
      sourceLink.setAttribute("aria-disabled", "true");
    }
    return;
  }

  if (pageTitle) {
    pageTitle.textContent = APP_TITLE;
  }
  if (pageSubtitle) {
    pageSubtitle.innerHTML = `当前共管理 ${state.papers.length} 篇文献`;
  }

  if (sourceLink) {
    if (state.selectedPaper.sourceUrl) {
      sourceLink.href = state.selectedPaper.sourceUrl;
      sourceLink.classList.remove("is-disabled");
      sourceLink.removeAttribute("aria-disabled");
    } else {
      sourceLink.href = "#";
      sourceLink.classList.add("is-disabled");
      sourceLink.setAttribute("aria-disabled", "true");
    }
  }
}

function renderPaperForm() {
  if (!paperFormStatus || !paperSourceUrlInput || !savePaperButton) {
    return;
  }

  const hasSourceUrl = Boolean(paperSourceUrlInput.value.trim());

  paperFormStatus.textContent = state.paperFormStatus;
  savePaperButton.disabled = !state.serverReady || !state.currentUser || state.isSavingPaper;

  if (openSourceUrlButton) {
    openSourceUrlButton.disabled = !hasSourceUrl || state.isSavingPaper;
  }
}

function renderPaperList() {
  if (!paperList || !paperCount) {
    return;
  }

  const visiblePapers = getVisiblePapers();

  paperCount.textContent = `${visiblePapers.length} / ${state.papers.length} 篇`;

  if (!state.papers.length) {
    paperList.className = "paper-list empty-state";
    paperList.textContent = "storage 文件夹中还没有文献。";
    return;
  }

  if (!visiblePapers.length) {
    paperList.className = "paper-list empty-state";
    paperList.textContent = "没有匹配的文献，请换个关键词试试。";
    return;
  }

  paperList.className = "paper-list";
  paperList.innerHTML = visiblePapers
    .map((paper) => {
      const isActive = paper.id === state.selectedPaperId;
      const creatorText = paper.created_by_username
        ? `上传者：${paper.created_by_username}`
        : "上传者未知";
      const latestSpeakerText = paper.latestSpeakerUsername || "暂无";
      const latestSpeechText = paper.latestSpeechAt
        ? formatDateTime(paper.latestSpeechAt)
        : "暂无";
      const uploadTimeText = formatDateTime(paper.createdAt || paper.created_at);

      return `
        <button
          class="paper-item ${isActive ? "active" : ""}"
          type="button"
          data-paper-id="${paper.id}"
        >
          <strong>${escapeHtml(truncate(paper.title || "未命名文献", 90))}</strong>
          <span>${escapeHtml(truncate(paper.authors || "未填写作者", 90))}</span>
          <span class="paper-item-journal">${escapeHtml(truncate(paper.journal || "未填写来源", 90))}</span>
          <span>${escapeHtml(creatorText)}</span>
          <span class="paper-item-speech-meta">
            发言
            <strong>${escapeHtml(String(paper.speechCount || 0))}</strong>
            · 最新发言者
            <strong>${escapeHtml(latestSpeakerText)}</strong>
            · 发言时间
            <strong>${escapeHtml(latestSpeechText)}</strong>
            · 上传时间
            <strong>${escapeHtml(uploadTimeText)}</strong>
          </span>
        </button>
      `;
    })
    .join("");
}

function renderPaperMeta() {
  if (
    !paperJournal ||
    !paperTitle ||
    !paperAuthors ||
    !paperPublished ||
    !paperOwner ||
    !paperAbstract ||
    !paperKeywords ||
    !deletePaperButton
  ) {
    return;
  }

  if (!state.selectedPaper) {
    paperJournal.textContent = "请选择一篇文献";
    paperTitle.textContent = IS_DETAIL_PAGE
      ? "返回列表选择文献后开始阅读"
      : "左侧输入网址或选择文献后开始阅读";
    paperAuthors.textContent = "";
    paperPublished.textContent = "";
    paperOwner.textContent = "";
    paperAbstract.textContent = "";
    paperKeywords.innerHTML = "";
    deletePaperButton.disabled = true;
    return;
  }

  paperJournal.textContent = state.selectedPaper.journal || "未填写来源";
  paperTitle.textContent = state.selectedPaper.title || "未命名文献";
  paperAuthors.textContent = state.selectedPaper.authors || "";
  paperPublished.textContent = state.selectedPaper.published
    ? `Published: ${state.selectedPaper.published}`
    : "";
  paperOwner.textContent = state.selectedPaper.created_by_username
    ? `上传者：${state.selectedPaper.created_by_username}`
    : "上传者未知";
  paperAbstract.textContent = state.selectedPaper.abstract
    ? `摘要：${state.selectedPaper.abstract}`
    : "";
  paperKeywords.innerHTML = (state.selectedPaper.keywords || [])
    .map((keyword) => `<span class="keyword-chip">${escapeHtml(keyword)}</span>`)
    .join("");
  deletePaperButton.disabled = !canDeletePaper(state.selectedPaper);
}

function renderArticle() {
  if (!articleRoot || !annotationRoot) {
    return;
  }

  if (!state.selectedPaper) {
    articleRoot.innerHTML =
      '<div class="empty-state">当前还没有选中文献。抓取成功后，文献详情和网页快照会从运行时存储目录加载。</div>';
    return;
  }

  if (!state.articleLoaded) {
    articleRoot.innerHTML = '<p class="empty-state">正在加载当前文献正文，请稍候...</p>';
    return;
  }

  if (!state.articleHtml) {
    articleRoot.innerHTML = `
      <div class="empty-state">
        <p>这篇文献目前没有可用的网页快照。</p>
        <p>如果抓取失败，请确认网址能被当前环境访问，然后重新抓取。</p>
      </div>
    `;
  } else {
    articleRoot.innerHTML = state.articleHtml;
    renderArticleMath(articleRoot);
    if (isArticleImagesEnabledForPaper(state.selectedPaper)) {
      installArticleImageFallbacks(articleRoot, state.selectedPaper?.sourceUrl || "");
    }
  }

  const sortedAnnotations = [...getTopLevelAnnotations()].sort((left, right) => {
    const scopeOrder =
      getScopeSortOrder(right.target_scope) - getScopeSortOrder(left.target_scope);

    if (scopeOrder !== 0) {
      return scopeOrder;
    }

    return right.start_offset - left.start_offset;
  });

  for (const annotation of sortedAnnotations) {
    applyAnnotationHighlight(annotation);
  }

  syncPendingSelectionHighlight();

  syncActiveHighlight();
}

function renderSelectionPanel() {
  if (!selectionStatus || !addAnnotationButton || !cancelAnnotationButton || !annotationAttachmentsInput) {
    return;
  }

  const hasAnnotatableContent = hasAvailableAnnotatableContent();
  const hasSelection = Boolean(state.pendingSelection);

  selectionStatus.textContent = hasSelection
    ? `已捕获${getAnnotationScopeLabel(state.pendingSelection.target_scope)}选区`
    : hasAnnotatableContent
      ? "未选择文本"
      : "当前文献不可批注";

  addAnnotationButton.disabled =
    !state.serverReady ||
    !state.currentUser ||
    !hasSelection ||
    !hasAnnotatableContent ||
    state.isSavingAnnotation;
  annotationAttachmentsInput.disabled =
    !state.serverReady ||
    !state.currentUser ||
    !hasSelection ||
    !hasAnnotatableContent ||
    state.isSavingAnnotation;
  cancelAnnotationButton.classList.toggle("is-hidden", !hasSelection);
  cancelAnnotationButton.disabled = !hasSelection || state.isSavingAnnotation;
}

function renderReaderContextMenu() {
  if (!readerContextMenu) {
    return;
  }

  const menu = getRenderableReaderContextMenu();

  if (!menu) {
    state.readerContextMenu = null;
    readerContextMenu.innerHTML = "";
    readerContextMenu.className = "reader-context-menu is-hidden";
    readerContextMenu.setAttribute("aria-hidden", "true");
    return;
  }

  readerContextMenu.innerHTML = `
    <button
      class="reader-context-menu-button ${menu.danger ? "is-danger" : ""}"
      type="button"
      role="menuitem"
      data-reader-context-action="${menu.action}"
      ${menu.disabled ? "disabled" : ""}
    >
      ${escapeHtml(menu.label)}
    </button>
  `;
  readerContextMenu.className = "reader-context-menu";
  readerContextMenu.setAttribute("aria-hidden", "false");

  const menuWidth = readerContextMenu.offsetWidth;
  const menuHeight = readerContextMenu.offsetHeight;
  const padding = 12;
  const left = Math.min(
    Math.max(padding, menu.x),
    Math.max(padding, window.innerWidth - menuWidth - padding)
  );
  const top = Math.min(
    Math.max(padding, menu.y),
    Math.max(padding, window.innerHeight - menuHeight - padding)
  );

  readerContextMenu.style.left = `${left}px`;
  readerContextMenu.style.top = `${top}px`;
}

function renderAnnotationList() {
  if (!annotationList || !annotationCount || !clearStorageButton || !deleteAnnotationButton) {
    return;
  }

  const topLevelAnnotations = getTopLevelAnnotations();
  const replyCount = getReplyAnnotations().length;
  clearStorageButton.disabled =
    !state.currentUser || !state.selectedPaper || getOwnAnnotationsForSelectedPaper().length === 0;
  deleteAnnotationButton.disabled = !topLevelAnnotations.some(
    (annotation) =>
      annotation.id === state.selectedAnnotationId && canDeleteAnnotation(annotation)
  );
  annotationCount.textContent = `${topLevelAnnotations.length} 条批注 / ${replyCount} 条回复`;
  renderSpeechThreadList("annotation");
}

function renderAnnotationDetail() {
  renderSpeechThreadDetail("annotation");
}

function renderReplyComposer() {
  renderSpeechReplyComposer("annotation");
}

function renderDiscussionComposer() {
  if (
    !discussionStatus ||
    !discussionInput ||
    !addDiscussionButton ||
    !cancelDiscussionButton ||
    !discussionAttachmentsInput
  ) {
    return;
  }

  const hasPaper = Boolean(state.selectedPaper);
  const canPost = Boolean(state.serverReady && state.currentUser && hasPaper) && !state.isSavingDiscussion;
  const hasInput = Boolean(discussionInput.value.trim());
  const hasAttachments = getAttachmentFiles(discussionAttachmentsInput).length > 0;

  if (!state.currentUser) {
    discussionStatus.textContent = "登录后可发布讨论";
  } else if (!hasPaper) {
    discussionStatus.textContent = "请选择文献";
  } else if (!state.serverReady) {
    discussionStatus.textContent = "服务未启动";
  } else if (state.isSavingDiscussion) {
    discussionStatus.textContent = "讨论发布中...";
  } else {
    discussionStatus.textContent = "可发布讨论";
  }
  discussionAttachmentsInput.disabled = !canPost;
  addDiscussionButton.disabled = !canPost || (!hasInput && !hasAttachments);
  cancelDiscussionButton.disabled = (!hasInput && !hasAttachments) || state.isSavingDiscussion;
  cancelDiscussionButton.classList.toggle("is-hidden", !hasInput && !hasAttachments);
  syncComposerTextareaState({ currentTarget: discussionInput });
}

function getSpeechKindOptions(kind) {
  if (kind === "discussion") {
    return {
      addReplyButton: addDiscussionReplyButton,
      canDelete: canDeleteDiscussion,
      canEdit: canEditDiscussion,
      detailElement: discussionDetail,
      deleteButton: deleteDiscussionButton,
      detailEmptyText: "选择一条讨论后，这里会展示讨论内容与回复。",
      editActionLabel: "讨论",
      editButton: editDiscussionButton,
      editInputId: "discussion-detail-editor",
      editState: state.discussionEditState,
      emptyListText: "这篇文献还没有讨论。",
      emptyReplyText: "还没有人回复这条讨论。",
      getActiveReplyTarget: getActiveDiscussionReplyTarget,
      getAuthorName: getDiscussionAuthorName,
      getEditTarget: getDiscussionEditTarget,
      getReplies: getRepliesForDiscussion,
      getReplyRelationText: getDiscussionReplyRelationText,
      getSelectedReplyId: () => state.selectedDiscussionReplyId,
      getSelectedThread: getSelectedDiscussionThread,
      getSelectedThreadId: () => state.selectedDiscussionId,
      getThreadRootId: getThreadRootDiscussionId,
      kind,
      listElement: discussionList,
      listEmptyText: "选择文献后可查看讨论。",
      listItemDataAttribute: "data-discussion-id",
      listItemDataKey: "discussionId",
      noun: "讨论",
      replyContext: discussionReplyContext,
      replyDeleteDataAttribute: "data-delete-discussion-reply-id",
      replyEditDataAttribute: "data-edit-discussion-reply-id",
      replyElementDataAttribute: "data-discussion-reply-id",
      replyEmptyText: "选择一条讨论后可在这里继续回复。",
      replyInput: discussionReplyInput,
      replyInputEmptyLabel: "回复当前讨论",
      replyInputTargetLabel: "回复",
      replySavingStateKey: "isSavingDiscussionReply",
      selectedReplyIdKey: "selectedDiscussionReplyId",
      selectedThreadIdKey: "selectedDiscussionId",
    };
  }

  return {
    addReplyButton,
    canDelete: canDeleteAnnotation,
    canEdit: canEditAnnotation,
    detailElement: annotationDetail,
    deleteButton: deleteAnnotationButton,
    detailEmptyText: "点击正文高亮或下方批注列表中的条目后，这里会显示批注内容与讨论线程。",
    editActionLabel: "批注",
    editButton: editAnnotationButton,
    editInputId: "annotation-detail-editor",
    editState: state.annotationEditState,
    emptyListText: "这篇文献还没有批注。",
    emptyReplyText: "还没有人回复这条批注。",
    getActiveReplyTarget: getActiveReplyTargetAnnotation,
    getAuthorName: getAnnotationAuthorName,
    getEditTarget: getAnnotationEditTarget,
    getReplies: getRepliesForAnnotation,
    getReplyRelationText: getReplyRelationText,
    getSelectedReplyId: () => state.selectedReplyId,
    getSelectedThread: getSelectedThreadAnnotation,
    getSelectedThreadId: () => state.selectedAnnotationId,
    getThreadRootId: getThreadRootAnnotationId,
    kind,
    listElement: annotationList,
    listEmptyText: "选择文献后可查看它的批注。",
    listItemDataAttribute: "data-annotation-id",
    listItemDataKey: "annotationId",
    noun: "批注",
    replyContext,
    replyDeleteDataAttribute: "data-delete-reply-id",
    replyEditDataAttribute: "data-edit-reply-id",
    replyElementDataAttribute: "data-reply-id",
    replyEmptyText: "选择一条批注后可在这里继续讨论。",
    replyInput,
    replyInputEmptyLabel: "回复当前批注",
    replyInputTargetLabel: "回复",
    replySavingStateKey: "isSavingReply",
    selectedReplyIdKey: "selectedReplyId",
    selectedThreadIdKey: "selectedAnnotationId",
  };
}

function getSpeechTopLevelRecords(kind) {
  return kind === "discussion" ? getTopLevelDiscussions() : getTopLevelAnnotations();
}

function getSpeechReplyRecords(kind) {
  return kind === "discussion" ? getDiscussionReplies() : getReplyAnnotations();
}

function getSortedTopLevelSpeechRecords(kind) {
  return [...getSpeechTopLevelRecords(kind)].sort((left, right) => {
    const leftReplies = getSpeechKindOptions(kind).getReplies(left.id);
    const rightReplies = getSpeechKindOptions(kind).getReplies(right.id);
    const leftActivityTime = new Date(
      (leftReplies[leftReplies.length - 1]?.created_at || left.created_at || 0)
    ).getTime();
    const rightActivityTime = new Date(
      (rightReplies[rightReplies.length - 1]?.created_at || right.created_at || 0)
    ).getTime();

    return rightActivityTime - leftActivityTime;
  });
}

function renderSpeechThreadList(kind) {
  const options = getSpeechKindOptions(kind);
  const { listElement } = options;

  if (!listElement) {
    return;
  }

  const topLevelRecords = getSortedTopLevelSpeechRecords(kind);

  if (!state.selectedPaper) {
    listElement.className = "annotation-list empty-state";
    listElement.textContent = options.listEmptyText;
    return topLevelRecords;
  }

  if (!topLevelRecords.length) {
    listElement.className = "annotation-list empty-state";
    listElement.textContent = options.emptyListText;
    return topLevelRecords;
  }

  listElement.className = "annotation-list";
  listElement.innerHTML = topLevelRecords
    .map((record) => {
      const isActive = record.id === options.getSelectedThreadId();
      const creator = record.created_by_username || "未知用户";
      const replies = options.getReplies(record.id);
      const latestReply = replies[replies.length - 1] || null;
      return `
        <button
          class="annotation-item ${isActive ? "active" : ""}"
          type="button"
          ${options.listItemDataAttribute}="${record.id}"
        >
          <div class="annotation-item-header">
            <strong>${escapeHtml(`${creator}：${truncate(getRecordNoteDisplay(record), 72)}`)}</strong>
            <time>${escapeHtml(formatDateTime(record.created_at))}</time>
          </div>
          ${renderAttachmentSummaryTag(record)}
          <span>${escapeHtml(replies.length ? `回复 ${replies.length} 条` : "暂无回复")}</span>
          <span class="${latestReply ? "annotation-latest-reply" : ""}">${escapeHtml(
            latestReply
              ? `最新回复：${latestReply.created_by_username || "未知用户"} · ${formatDateTime(
                  latestReply.created_at
                )}`
              : "还没有人参与讨论"
          )}</span>
        </button>
      `;
    })
    .join("");

  return topLevelRecords;
}

function renderSpeechThreadDetail(kind) {
  const options = getSpeechKindOptions(kind);
  const { detailElement, editButton, deleteButton, editState } = options;

  if (!detailElement || !editButton) {
    return;
  }

  const record = options.getSelectedThread();

  if (!record) {
    detailElement.className = "annotation-detail empty-state is-compact";
    detailElement.textContent = options.detailEmptyText;
    editButton.disabled = true;
    editButton.textContent = "编辑";
    if (deleteButton) {
      deleteButton.disabled = true;
    }
    return;
  }

  const replies = options.getReplies(record.id);
  const editTarget = options.getEditTarget();
  const isEditing = Boolean(editTarget) && options.getThreadRootId(editTarget) === record.id;
  detailElement.className = "annotation-detail";
  editButton.disabled = !options.canEdit(record) || isEditing || editState.isSaving;
  editButton.textContent = isEditing ? "编辑中" : "编辑";
  if (deleteButton) {
    deleteButton.disabled = !options.canDelete(record) || isEditing || editState.isSaving;
  }

  if (isEditing) {
    const isEditingReply = editState.targetType === "reply";
    detailElement.innerHTML = `
      <div class="detail-inline-editor">
        <label class="detail-inline-editor-label" for="${options.editInputId}">${
          isEditingReply ? "编辑回复" : `编辑${options.editActionLabel}`
        }</label>
        <textarea
          id="${options.editInputId}"
          class="detail-inline-editor-input"
          rows="5"
          ${editState.isSaving ? "disabled" : ""}
        >${escapeHtml(editState.draft)}</textarea>
        ${renderDetailEditAttachments(kind, editState)}
        <div class="composer-actions detail-inline-editor-actions">
          <button
            class="primary-button"
            type="button"
            data-save-${kind}-edit="true"
            ${editState.isSaving ? "disabled" : ""}
          >
            ${editState.isSaving ? "保存中..." : isEditingReply ? "保存回复" : `保存${options.editActionLabel}`}
          </button>
          <button
            class="ghost-button"
            type="button"
            data-cancel-${kind}-edit="true"
            ${editState.isSaving ? "disabled" : ""}
          >
            取消
          </button>
        </div>
      </div>
    `;
    return;
  }

  detailElement.innerHTML = `
    <p><strong>${escapeHtml(record.created_by_username || "未知用户")}：</strong>${formatRecordNoteHtml(
      record
    )}</p>
    ${renderAttachmentList(record.attachments)}
    <h4>讨论线程</h4>
    <div class="thread-list ${replies.length ? "" : "empty-state"}">
      ${
        replies.length
          ? replies
              .map(
                (reply) => `
                  <article
                    class="thread-reply ${reply.id === options.getSelectedReplyId() ? "active" : ""}"
                    ${options.replyElementDataAttribute}="${reply.id}"
                  >
                    <div class="thread-reply-header">
                      <strong>${escapeHtml(options.getReplyRelationText(reply))}</strong>
                      <time>${escapeHtml(formatDateTime(reply.created_at))}</time>
                    </div>
                    <p>${formatRecordNoteHtml(reply)}</p>
                    ${renderAttachmentList(reply.attachments)}
                    ${
                      options.canEdit(reply) || options.canDelete(reply)
                        ? `
                          <div class="thread-reply-actions">
                            ${
                              options.canEdit(reply)
                                ? `
                                  <button
                                    class="ghost-button thread-reply-edit"
                                    type="button"
                                    ${options.replyEditDataAttribute}="${reply.id}"
                                  >
                                    编辑
                                  </button>
                                `
                                : ""
                            }
                            ${
                              options.canDelete(reply)
                                ? `
                                  <button
                                    class="ghost-button danger-button thread-reply-delete"
                                    type="button"
                                    ${options.replyDeleteDataAttribute}="${reply.id}"
                                  >
                                    删除
                                  </button>
                                `
                                : ""
                            }
                          </div>
                        `
                        : ""
                    }
                  </article>
                `
              )
              .join("")
          : `<p>${options.emptyReplyText}</p>`
      }
    </div>
  `;
}

function renderSpeechReplyComposer(kind) {
  const options = getSpeechKindOptions(kind);
  const { replyContext, replyInput, addReplyButton, replyInputEmptyLabel } = options;
  const replyAttachmentsField =
    kind === "discussion" ? discussionReplyAttachmentsInput : replyAttachmentsInput;

  if (!replyContext || !replyInput || !addReplyButton || !replyAttachmentsField) {
    return;
  }

  const selectedRecord = options.getSelectedThread();
  const replyTarget = options.getActiveReplyTarget();
  const canReply =
    Boolean(state.serverReady && state.currentUser && selectedRecord) &&
    !state[options.replySavingStateKey];

  replyContext.textContent = selectedRecord
    ? `回复 ${options.getAuthorName(replyTarget)}：${truncate(getRecordNoteDisplay(replyTarget), 5)}`
    : options.replyEmptyText;
  replyInput.disabled = !canReply;
  replyAttachmentsField.disabled = !canReply;
  addReplyButton.disabled = !canReply;
  addReplyButton.textContent = selectedRecord
    ? `${options.replyInputTargetLabel} ${truncate(options.getAuthorName(replyTarget), 16)}`
    : replyInputEmptyLabel;
  syncComposerTextareaState({ currentTarget: replyInput });
}

function renderDiscussionList() {
  if (!discussionCount) {
    return;
  }

  const topLevelDiscussions = renderSpeechThreadList("discussion");
  const replyCount = getSpeechReplyRecords("discussion").length;
  const totalCount = topLevelDiscussions.length + replyCount;
  discussionCount.textContent = `（${totalCount}）`;
}

function renderDiscussionDetail() {
  renderSpeechThreadDetail("discussion");
}

function renderDiscussionReplyComposer() {
  renderSpeechReplyComposer("discussion");
}

function syncComposerTextareaState(event) {
  const target = event?.currentTarget;

  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }

  const shouldExpand = target === document.activeElement || Boolean(target.value.trim());
  target.classList.add("compact-textarea");
  target.classList.toggle("is-expanded", shouldExpand);
}

function renderProfileSummary() {
  profileStats.textContent = `${state.myUploadedPapers.length} 篇上传 / ${state.myAnnotations.length} 条发言`;
  accountSettingsButton.disabled = !state.currentUser;
  userManagementButton?.classList.toggle("is-hidden", !isCurrentUserAdmin());
  if (userManagementButton) {
    userManagementButton.disabled = !state.currentUser;
  }

  if (!state.currentUser) {
    profileSummary.className = "profile-summary empty-state";
    profileSummary.textContent = "登录后可查看你的账号信息。";
    return;
  }

  profileSummary.className = "profile-summary";
  profileSummary.innerHTML = `
    <p class="profile-username">用户名：<code>${escapeHtml(state.currentUser.username)}</code></p>
    <p>账号角色：${escapeHtml(getUserRole(state.currentUser) === "admin" ? "管理员" : "普通成员")}</p>
    <p>账号创建时间：${escapeHtml(formatDateTime(state.currentUser.createdAt))}</p>
  `;
}

function renderProfilePanels() {
  const activePanel = state.profilePanel || "papers";
  const panelEntries = [
    ["papers", profilePanelPapersButton, profilePanelPapers],
    ["speeches", profilePanelSpeechesButton, profilePanelSpeeches],
    ["replies", profilePanelRepliesButton, profilePanelReplies],
  ];

  panelEntries.forEach(([panelName, button, panel]) => {
    const isActive = panelName === activePanel;
    button?.classList.toggle("active", isActive);
    button?.setAttribute("aria-selected", String(isActive));
    panel?.classList.toggle("is-hidden", !isActive);
  });
}

function renderMemberList() {
  memberCount.textContent = `${state.groupMembers.length} 人`;

  if (!state.currentUser) {
    memberList.className = "paper-list empty-state";
    memberList.textContent = "登录后可查看组员动向。";
    return;
  }

  if (!state.groupMembers.length) {
    memberList.className = "paper-list empty-state";
    memberList.textContent = "当前还没有其他成员。";
    return;
  }

  memberList.className = "paper-list";
  memberList.innerHTML = state.groupMembers
    .map((member) => {
      const isActive = member.id === state.selectedMemberId;
      return `
        <button
          class="paper-item ${isActive ? "active" : ""}"
          type="button"
          data-member-id="${member.id}"
        >
          <strong>${escapeHtml(formatUserBadge(member))}</strong>
          <span>用户名：${escapeHtml(member.username)}</span>
          <span>累计上传 ${escapeHtml(String(member.uploadedPaperCount || 0))} 篇 · 累计发言 ${escapeHtml(
            String(member.annotationCount || 0)
          )} 条</span>
          <span>加入时间：${escapeHtml(formatDateTime(member.createdAt))}</span>
        </button>
      `;
    })
    .join("");
}

function renderMemberProfileSummary() {
  if (!memberProfileStats || !memberProfileSummary) {
    return;
  }
}

function renderMemberProfilePanels() {
  const activePanel = state.memberProfilePanel || "papers";
  const panelEntries = [
    ["papers", memberProfilePapersButton, memberProfilePapers],
    ["speeches", memberProfileSpeechesButton, memberProfileSpeeches],
  ];

  panelEntries.forEach(([panelName, button, panel]) => {
    const isActive = panelName === activePanel;
    button?.classList.toggle("active", isActive);
    button?.setAttribute("aria-selected", String(isActive));
    panel?.classList.toggle("is-hidden", !isActive);
  });
}

function renderAccountSettings() {
  if (usernameStatus) {
    usernameStatus.textContent = state.usernameStatus;
  }

  if (currentUsernameInput) {
    currentUsernameInput.value = state.currentUser?.username || "";
  }

  if (changeUsernameButton) {
    changeUsernameButton.disabled =
      !state.serverReady || !state.currentUser || state.isUpdatingUsername;
  }

  if (nextUsernameInput) {
    nextUsernameInput.disabled = !state.serverReady || !state.currentUser || state.isUpdatingUsername;
  }

  passwordStatus.textContent = state.passwordStatus;
  changePasswordButton.disabled =
    !state.serverReady || !state.currentUser || state.isChangingPassword;
}

function renderUserManagement() {
  if (userManagementStatus) {
    userManagementStatus.textContent = state.userManagementStatus;
  }

  if (createUserButton) {
    createUserButton.disabled =
      !state.serverReady || !isCurrentUserAdmin() || state.isCreatingUser || state.isManagingUser;
  }

  if (createUserUsernameInput) {
    createUserUsernameInput.disabled =
      !state.serverReady || !isCurrentUserAdmin() || state.isCreatingUser || state.isManagingUser;
  }

  if (createUserPasswordInput) {
    createUserPasswordInput.disabled =
      !state.serverReady || !isCurrentUserAdmin() || state.isCreatingUser || state.isManagingUser;
  }

  if (createUserConfirmPasswordInput) {
    createUserConfirmPasswordInput.disabled =
      !state.serverReady || !isCurrentUserAdmin() || state.isCreatingUser || state.isManagingUser;
  }

  if (managedUserCount) {
    managedUserCount.textContent = `${state.allUsers.length} 人`;
  }

  if (!managedUserList) {
    return;
  }

  if (!state.currentUser) {
    managedUserList.className = "annotation-list empty-state";
    managedUserList.textContent = "登录后可查看用户管理。";
    return;
  }

  if (!isCurrentUserAdmin()) {
    managedUserList.className = "annotation-list empty-state";
    managedUserList.textContent = "只有管理员可以查看用户管理。";
    return;
  }

  if (!state.allUsers.length) {
    managedUserList.className = "annotation-list empty-state";
    managedUserList.textContent = "当前还没有用户数据。";
    return;
  }

  managedUserList.className = "annotation-list";
  managedUserList.innerHTML = state.allUsers
    .map(
      (user) => {
        const isCurrentUser = user.id === state.currentUser.id;
        const canManageUser = !isCurrentUser && getUserRole(user) !== "admin";
        const isDeletingUser =
          state.isManagingUser &&
          state.managedUserActionUserId === user.id &&
          state.managedUserActionType === "delete";
        const isTransferringAdmin =
          state.isManagingUser &&
          state.managedUserActionUserId === user.id &&
          state.managedUserActionType === "transfer";
        const actionsHtml = canManageUser
          ? `
            <div class="annotation-item-actions">
              <button
                class="ghost-button"
                type="button"
                data-transfer-admin-user-id="${user.id}"
                ${state.isManagingUser ? "disabled" : ""}
              >
                ${isTransferringAdmin ? "转让中..." : "转让管理员"}
              </button>
              <button
                class="ghost-button danger-button"
                type="button"
                data-delete-user-id="${user.id}"
                ${state.isManagingUser ? "disabled" : ""}
              >
                ${isDeletingUser ? "删除中..." : "删除用户"}
              </button>
            </div>
          `
          : "";

        return `
        <article class="annotation-item">
          <div class="annotation-item-body">
            <div class="annotation-item-header">
              <strong>${escapeHtml(formatUserBadge(user))}${isCurrentUser ? "（当前登录）" : ""}</strong>
              <time>${escapeHtml(formatDateTime(user.createdAt))}</time>
            </div>
            <span class="annotation-target">用户名：${escapeHtml(user.username)}</span>
            <span>已上传 ${escapeHtml(String(user.uploadedPaperCount || 0))} 篇 · 已发言 ${escapeHtml(
              String(user.annotationCount || 0)
            )} 条</span>
          </div>
          ${actionsHtml}
        </article>
      `;
      }
    )
    .join("");
}

function renderMyPaperList() {
  myPaperCount.textContent = `${state.myUploadedPapers.length} 篇`;

  if (!state.currentUser) {
    myPaperList.className = "annotation-list empty-state";
    myPaperList.textContent = "登录后可查看你上传的文章。";
    return;
  }

  if (!state.myUploadedPapers.length) {
    myPaperList.className = "annotation-list empty-state";
    myPaperList.textContent = "你还没有上传自己的文章。";
    return;
  }

  myPaperList.className = "annotation-list";
  myPaperList.innerHTML = state.myUploadedPapers
    .map(
      (paper) => `
        <article class="annotation-item ${paper.id === state.selectedPaperId ? "active" : ""}">
          <div
            class="annotation-item-body"
          >
            <div class="annotation-item-header">
              <strong>${escapeHtml(truncate(paper.title || "未命名文献", 96))}</strong>
              <time>${escapeHtml(formatDateTime(paper.activity_at || paper.createdAt))}</time>
            </div>
            <span class="annotation-target">${escapeHtml(paper.journal || "未填写来源")}</span>
            <span>${escapeHtml(truncate(paper.authors || "未填写作者", 120))}</span>
            <span>${paper.published ? `发表时间：${escapeHtml(paper.published)}` : "发表时间未知"}</span>
          </div>
          <div class="annotation-item-actions">
            <button
              class="ghost-button"
              type="button"
              data-open-profile-paper-id="${paper.id}"
            >
              详情
            </button>
            <button
              class="ghost-button danger-button"
              type="button"
              data-delete-profile-paper-id="${paper.id}"
            >
              删除文章
            </button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderMyAnnotationList() {
  myAnnotationCount.textContent = `${state.myAnnotations.length} 条`;

  if (!state.currentUser) {
    myAnnotationList.className = "annotation-list empty-state";
    myAnnotationList.textContent = "登录后可查看你的发言。";
    return;
  }

  if (!state.myAnnotations.length) {
    myAnnotationList.className = "annotation-list empty-state";
    myAnnotationList.textContent = "你还没有创建自己的发言。";
    return;
  }

  myAnnotationList.className = "annotation-list";
  myAnnotationList.innerHTML = state.myAnnotations
    .map((annotation) => {
      const speechType = annotation.speech_type || "annotation";
      const threadId =
        annotation.thread_id ||
        annotation.thread_annotation_id ||
        annotation.thread_discussion_id ||
        annotation.id;
      const activeThreadId =
        speechType === "discussion" ? state.selectedDiscussionId : state.selectedAnnotationId;
      const activeReplyId =
        speechType === "discussion" ? state.selectedDiscussionReplyId : state.selectedReplyId;
      const isCurrentTarget =
        threadId === activeThreadId && (!annotation.is_reply || annotation.id === activeReplyId);
      const paperTitle = annotation.paperExists
        ? truncate(annotation.paperTitle || "未命名文献", 100)
        : "文献已删除";
      const isReply = Boolean(annotation.is_reply);
      const rootLabel = speechType === "discussion" ? "讨论" : "批注";
      const speechText = isReply
        ? `${annotation.created_by_username || "未知用户"}回复${annotation.parent_username || "未知用户"}: ${truncate(getRecordNoteDisplay(annotation), 90)}`
        : `${annotation.created_by_username || "未知用户"}${rootLabel}: ${truncate(getRecordNoteDisplay(annotation), 90)}`;
      const deleteLabel = isReply ? "删除回复" : speechType === "discussion" ? "删除讨论" : "删除批注";
      return `
        <article class="annotation-item ${isCurrentTarget ? "active" : ""}">
          <div class="annotation-item-body">
            <strong class="annotation-item-text">${escapeHtml(speechText)}</strong>
            <span class="annotation-target">${escapeHtml(paperTitle)}</span>
            ${renderAttachmentSummaryTag(annotation)}
          </div>
          <div class="annotation-item-actions">
            <button
              class="ghost-button"
              type="button"
              data-open-my-speech-id="${annotation.id}"
              data-speech-type="${speechType}"
              data-paper-id="${annotation.paperId}"
              data-thread-id="${threadId}"
              data-reply-id="${isReply ? annotation.id : ""}"
            >
              详情
            </button>
            <button
              class="ghost-button danger-button"
              type="button"
              data-delete-my-speech-id="${annotation.id}"
              data-speech-type="${speechType}"
            >
              ${deleteLabel}
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderReceivedReplyList() {
  receivedReplyCount.textContent = `${state.receivedReplies.length} 条`;

  if (!state.currentUser) {
    receivedReplyList.className = "annotation-list empty-state";
    receivedReplyList.textContent = "登录后可查看别人回复你。";
    return;
  }

  if (!state.receivedReplies.length) {
    receivedReplyList.className = "annotation-list empty-state";
    receivedReplyList.textContent = "目前还没有人回复你。";
    return;
  }

  receivedReplyList.className = "annotation-list";
  receivedReplyList.innerHTML = state.receivedReplies
    .map((reply) => {
      const speechType = reply.speech_type || "annotation";
      const threadId =
        reply.thread_id || reply.thread_annotation_id || reply.thread_discussion_id || reply.id;
      const activeThreadId =
        speechType === "discussion" ? state.selectedDiscussionId : state.selectedAnnotationId;
      const activeReplyId =
        speechType === "discussion" ? state.selectedDiscussionReplyId : state.selectedReplyId;
      const isCurrentTarget = threadId === activeThreadId && reply.id === activeReplyId;
      const paperTitle = truncate(reply.paperTitle || "文献已删除", 100);
      const speechText = `${reply.created_by_username || "未知用户"}回复${
        reply.reply_to_username || "未知用户"
      }: ${truncate(getRecordNoteDisplay(reply), 90)}`;
      return `
        <article class="annotation-item ${isCurrentTarget ? "active" : ""}">
          <div class="annotation-item-body">
            <strong class="annotation-item-text">${escapeHtml(speechText)}</strong>
            <span class="annotation-target">${escapeHtml(paperTitle)}</span>
            ${renderAttachmentSummaryTag(reply)}
          </div>
          <div class="annotation-item-actions">
            <button
              class="ghost-button"
              type="button"
              data-open-received-speech-id="${reply.id}"
              data-speech-type="${speechType}"
              data-paper-id="${reply.paperId}"
              data-thread-id="${threadId}"
              data-reply-id="${reply.id}"
            >
              详情
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMemberProfilePaperList() {
  const uploadedPapers = state.selectedMemberProfile?.uploadedPapers || [];
  memberProfilePaperCount.textContent = `${uploadedPapers.length} 篇`;

  if (!state.currentUser) {
    memberProfilePaperList.className = "annotation-list empty-state";
    memberProfilePaperList.textContent = "登录后可查看其他成员上传的文章。";
    return;
  }

  if (!state.selectedMemberId) {
    memberProfilePaperList.className = "annotation-list empty-state";
    memberProfilePaperList.textContent = "请选择一位成员。";
    return;
  }

  if (!state.selectedMemberProfile) {
    memberProfilePaperList.className = "annotation-list empty-state";
    memberProfilePaperList.textContent = "正在加载文章列表...";
    return;
  }

  if (!uploadedPapers.length) {
    memberProfilePaperList.className = "annotation-list empty-state";
    memberProfilePaperList.textContent = "这位成员还没有上传文章。";
    return;
  }

  memberProfilePaperList.className = "annotation-list";
  memberProfilePaperList.innerHTML = uploadedPapers
    .map(
      (paper) => `
        <article class="annotation-item ${paper.id === state.selectedPaperId ? "active" : ""}">
          <div class="annotation-item-body">
            <div class="annotation-item-header">
              <strong>${escapeHtml(truncate(paper.title || "未命名文献", 96))}</strong>
              <time>${escapeHtml(formatDateTime(paper.activity_at || paper.createdAt))}</time>
            </div>
            <span class="annotation-target">${escapeHtml(paper.journal || "未填写来源")}</span>
            <span>${escapeHtml(truncate(paper.authors || "未填写作者", 120))}</span>
            <span>${paper.published ? `发表时间：${escapeHtml(paper.published)}` : "发表时间未知"}</span>
          </div>
          <div class="annotation-item-actions">
            <button
              class="ghost-button"
              type="button"
              data-open-member-paper-id="${paper.id}"
            >
              详情
            </button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderMemberProfileAnnotationList() {
  const annotations = state.selectedMemberProfile?.annotations || [];
  memberProfileAnnotationCount.textContent = `${annotations.length} 条`;

  if (!state.currentUser) {
    memberProfileAnnotationList.className = "annotation-list empty-state";
    memberProfileAnnotationList.textContent = "登录后可查看其他成员发言。";
    return;
  }

  if (!state.selectedMemberId) {
    memberProfileAnnotationList.className = "annotation-list empty-state";
    memberProfileAnnotationList.textContent = "请选择一位成员。";
    return;
  }

  if (!state.selectedMemberProfile) {
    memberProfileAnnotationList.className = "annotation-list empty-state";
    memberProfileAnnotationList.textContent = "正在加载发言列表...";
    return;
  }

  if (!annotations.length) {
    memberProfileAnnotationList.className = "annotation-list empty-state";
    memberProfileAnnotationList.textContent = "这位成员还没有创建发言。";
    return;
  }

  memberProfileAnnotationList.className = "annotation-list";
  memberProfileAnnotationList.innerHTML = annotations
    .map((annotation) => {
      const speechType = annotation.speech_type || "annotation";
      const threadId =
        annotation.thread_id ||
        annotation.thread_annotation_id ||
        annotation.thread_discussion_id ||
        annotation.id;
      const activeThreadId =
        speechType === "discussion" ? state.selectedDiscussionId : state.selectedAnnotationId;
      const activeReplyId =
        speechType === "discussion" ? state.selectedDiscussionReplyId : state.selectedReplyId;
      const isCurrentTarget =
        threadId === activeThreadId && (!annotation.is_reply || annotation.id === activeReplyId);
      const paperTitle = annotation.paperExists
        ? truncate(annotation.paperTitle || "未命名文献", 100)
        : "文献已删除";
      const isReply = Boolean(annotation.is_reply);
      const rootLabel = speechType === "discussion" ? "讨论" : "批注";
      const speechText = isReply
        ? `${annotation.created_by_username || "未知用户"}回复${annotation.parent_username || "未知用户"}: ${truncate(getRecordNoteDisplay(annotation), 90)}`
        : `${annotation.created_by_username || "未知用户"}${rootLabel}: ${truncate(getRecordNoteDisplay(annotation), 90)}`;

      return `
        <article class="annotation-item ${isCurrentTarget ? "active" : ""}">
          <div class="annotation-item-body">
            <strong class="annotation-item-text">${escapeHtml(speechText)}</strong>
            <span class="annotation-target">${escapeHtml(paperTitle)}</span>
            ${renderAttachmentSummaryTag(annotation)}
          </div>
          <div class="annotation-item-actions">
            <button
              class="ghost-button"
              type="button"
              data-open-member-speech-id="${annotation.id}"
              data-speech-type="${speechType}"
              data-paper-id="${annotation.paperId}"
              data-thread-id="${threadId}"
              data-reply-id="${isReply ? annotation.id : ""}"
            >
              详情
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function initializeAuthenticatedApp() {
  const status = await apiRequest("/api/status");
  state.databaseStatus = `服务已连接`;
  state.paperFormStatus = "等待抓取";
  state.usernameStatus = "请输入新的用户名";
  state.passwordStatus = "请输入当前密码和新密码";
  state.userManagementStatus = "管理员可以创建新的普通用户";

  await refreshPapers();
  await refreshMyDashboard();
  await refreshMembersData();

  if (IS_CATALOG_PAGE) {
    resetPaperSelection();
    return;
  }

  const detailRoute = readPaperRouteFromQuery();
  const hashPaperId = readPaperIdFromHash();
  const requestedPaperId = detailRoute.paperId || hashPaperId;
  const preferredPaperId = state.papers.some((paper) => paper.id === requestedPaperId)
    ? requestedPaperId
    : null;
  const fallbackPaperId = preferredPaperId || state.papers[0]?.id || null;

  if (detailRoute.panel) {
    state.libraryPanel = detailRoute.panel;
  }

  if (fallbackPaperId) {
    await selectPaper(fallbackPaperId, {
      updateHash: !IS_DETAIL_PAGE && fallbackPaperId !== preferredPaperId,
      focusAnnotationId: detailRoute.annotationId,
      focusReplyId: detailRoute.replyId,
      focusDiscussionId: detailRoute.discussionId,
      focusDiscussionReplyId: detailRoute.discussionReplyId,
    });
    return;
  }

  resetPaperSelection();
}

function resetPaperSelection() {
  state.selectedPaperId = null;
  state.selectedPaper = null;
  state.articleLoaded = false;
  state.articleHtml = "";
  state.pendingSelection = null;
  state.selectedAnnotationId = null;
  state.selectedReplyId = null;
  state.annotationNavigationTargetId = null;
  state.annotations = [];
  state.discussions = [];
  state.selectedDiscussionId = null;
  state.selectedDiscussionReplyId = null;
  state.discussionNavigationTargetId = null;
  state.readerContextMenu = null;
  resetAnnotationEditState();
  resetDiscussionEditState();
  clearComposerAttachments(annotationAttachmentsInput);
  clearComposerAttachments(replyAttachmentsInput);
  clearComposerAttachments(discussionAttachmentsInput);
  clearComposerAttachments(discussionReplyAttachmentsInput);
  window.getSelection()?.removeAllRanges();
}

function resetAppForLoggedOutState() {
  resetPaperSelection();
  state.currentView = "library";
  state.libraryPanel = "reader";
  state.profilePanel = "papers";
  state.memberProfilePanel = "papers";
  state.isUpdatingUsername = false;
  state.isChangingPassword = false;
  state.isCreatingUser = false;
  state.isManagingUser = false;
  state.managedUserActionUserId = "";
  state.managedUserActionType = "";
  state.papers = [];
  state.myUploadedPapers = [];
  state.myAnnotations = [];
  state.receivedReplies = [];
  state.allUsers = [];
  state.groupMembers = [];
  state.selectedMemberId = null;
  state.selectedMemberProfile = null;
  state.searchTerm = "";
  state.paperFormStatus = state.serverReady ? "登录后可抓取文献" : "请先启动 server.js";
  state.databaseStatus = state.serverReady ? "服务已连接，请先登录" : "服务未启动";
  state.usernameStatus = "请输入新的用户名";
  state.passwordStatus = "请输入当前密码和新密码";
  state.userManagementStatus = "管理员可以创建新的普通用户";
  if (paperSearchInput) {
    paperSearchInput.value = "";
  }
  if (paperSourceUrlInput) {
    paperSourceUrlInput.value = "";
  }
  if (paperRawHtmlInput) {
    paperRawHtmlInput.value = "";
  }
  if (annotationInput) {
    annotationInput.value = "";
  }
  if (replyInput) {
    replyInput.value = "";
  }
  if (discussionInput) {
    discussionInput.value = "";
  }
  if (discussionReplyInput) {
    discussionReplyInput.value = "";
  }
  clearComposerAttachments(annotationAttachmentsInput);
  clearComposerAttachments(replyAttachmentsInput);
  clearComposerAttachments(discussionAttachmentsInput);
  clearComposerAttachments(discussionReplyAttachmentsInput);
  usernameForm?.reset();
  passwordForm?.reset();
  createUserForm?.reset();
  writePaperIdToHash("");
}

async function switchView(viewName) {
  if (
    !state.currentUser ||
    state.currentView === viewName ||
    (viewName === "user-management" && !isCurrentUserAdmin())
  ) {
    return;
  }

  state.currentView = viewName;
  render();

  if (viewName === "members" && state.selectedMemberId && !state.selectedMemberProfile) {
    await refreshSelectedMemberProfile();
  }

  render();
}

function switchLibraryPanel(panelName) {
  if (!state.currentUser) {
    return;
  }

  const nextPanel = panelName === "discussion" ? "discussion" : "reader";

  if (state.libraryPanel === nextPanel) {
    return;
  }

  state.libraryPanel = nextPanel;

  if (nextPanel === "discussion") {
    closeReaderContextMenu();
    clearPendingSelection();
    syncPendingSelectionHighlight();
  }

  render();
}

function handlePasswordBackClick() {
  if (!state.currentUser) {
    return;
  }

  switchView("profile");
}

function handleUserManagementBackClick() {
  if (!state.currentUser) {
    return;
  }

  switchView("profile");
}

function switchProfilePanel(panelName) {
  if (!state.currentUser || state.profilePanel === panelName) {
    return;
  }

  state.profilePanel = panelName;
  renderProfilePanels();
}

function switchMemberProfilePanel(panelName) {
  if (!state.currentUser || state.memberProfilePanel === panelName) {
    return;
  }

  state.memberProfilePanel = panelName;
  renderMemberProfilePanels();
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  if (!state.serverReady || state.isLoggingIn) {
    return;
  }

  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;

  if (!username || !password) {
    state.loginStatus = "请输入账号密码";
    renderAuth();
    return;
  }

  state.isLoggingIn = true;
  state.loginStatus = "登录中...";
  renderAuth();

  try {
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    storeSessionToken(result.token || "");
    state.currentUser = result.user;
    storeCurrentUser(result.user);
    state.loginStatus = `已登录为 ${result.user.username}`;
    loginForm.reset();
    await initializeAuthenticatedApp();
    render();
  } catch (error) {
    console.error("Failed to login.", error);
    state.loginStatus = error.message || "登录失败";
    renderAuth();
  } finally {
    state.isLoggingIn = false;
    renderAuth();
  }
}

async function handleLogout() {
  try {
    await apiRequest("/api/auth/logout", {
      method: "POST",
    });
  } catch (error) {
    console.error("Failed to logout.", error);
  } finally {
    clearSessionToken();
    clearStoredCurrentUser();
    state.currentUser = null;
    state.loginStatus = "请输入账号密码";
    loginForm.reset();
    resetAppForLoggedOutState();
    render();
  }
}

async function handlePaperSubmit(event) {
  event.preventDefault();

  if (!state.serverReady || !state.currentUser || state.isSavingPaper) {
    return;
  }

  const sourceUrl = paperSourceUrlInput.value.trim();
  const rawHtml = paperRawHtmlInput?.value || "";
  const isHtmlImport = Boolean(rawHtml.trim());
  const isElsevierUpload = /(?:sciencedirect|elsevier)\.com/i.test(sourceUrl);

  if (!sourceUrl) {
    return;
  }

  state.isSavingPaper = true;
  state.paperFormStatus = isHtmlImport
    ? "正在导入源码并写入 storage..."
    : isElsevierUpload
      ? "正在通过内置 Elsevier API 获取全文并写入 storage..."
      : "正在抓取网页并写入 storage...";
  renderPaperForm();

  try {
    const savedPaper = await apiRequest(isHtmlImport ? "/api/papers/import-html" : "/api/papers", {
      method: "POST",
      body: JSON.stringify({
        sourceUrl,
        rawHtml,
      }),
    });

    state.paperFormStatus = isHtmlImport
      ? "源码导入成功，已写入 storage"
      : isElsevierUpload
        ? "Elsevier 全文导入成功，已写入 storage"
        : "抓取成功，已写入 storage";
    paperForm.reset();
    await refreshPapers();
    await refreshMyDashboard();
    await refreshMembersData();
    await selectPaper(savedPaper.id, { updateHash: !IS_CATALOG_PAGE });
  } catch (error) {
    console.error("Failed to fetch paper.", error);
    state.paperFormStatus = error.message || "抓取失败";

    if (!isHtmlImport && shouldOfferBrowserFetchFallback(state.paperFormStatus)) {
      state.paperFormStatus = "目标站点需要人工验证，请改用浏览器打开原文并导入 HTML 快照";
      paperRawHtmlInput?.focus();
      window.alert(
        [
          error.message || "抓取失败",
          "",
          "请点击“在浏览器打开文章网址”，在你自己的浏览器完成验证后，右键“查看页面源代码”，将 HTML 源码复制粘贴到输入框后再上传。",
          "如果文章来自 ScienceDirect，系统会自动尝试使用内置 Elsevier API 抓取全文 XML。",
        ].join("\n")
      );
      return;
    }

    window.alert(state.paperFormStatus);
  } finally {
    state.isSavingPaper = false;
    render();
  }
}

function handleOpenSourceUrlClick() {
  const sourceUrl = paperSourceUrlInput.value.trim();

  if (!sourceUrl) {
    state.paperFormStatus = "请先填写文献网址";
    render();
    return;
  }

  let normalizedSourceUrl = "";

  try {
    normalizedSourceUrl = new URL(sourceUrl).toString();
  } catch (error) {
    state.paperFormStatus = "请输入有效的网址";
    render();
    return;
  }

  const openedWindow = window.open(normalizedSourceUrl, "_blank");

  if (openedWindow) {
    try {
      openedWindow.opener = null;
      openedWindow.focus?.();
    } catch (error) {
      // Ignore cross-window focus issues and keep the guidance in PaperShare.
    }

    state.paperFormStatus =
      "已在你的浏览器打开原文。完成验证并进入论文正文后，请把“查看页面源代码”的 HTML 粘贴到上方，再点“抓取并保存”。";
  } else {
    state.paperFormStatus =
      "浏览器拦截了新窗口，请允许弹窗后重试，或手动打开该网址并把页面源代码粘贴到上方。";
    paperRawHtmlInput?.focus();
  }

  render();
}

function handlePaperSearchInput(event) {
  state.searchTerm = event.target.value.trim().toLowerCase();
  renderPaperList();
}

async function handlePaperListClick(event) {
  const item = event.target.closest("[data-paper-id]");

  if (!item) {
    return;
  }

  openPaperDetail({ paperId: item.dataset.paperId, panel: "reader" });
}

async function handlePaperListContextMenu(event) {
  const item = event.target.closest("[data-paper-id]");

  if (!item) {
    return;
  }

  const paperId = item.dataset.paperId;
  const paper = state.papers.find((entry) => entry.id === paperId);

  if (!paper || !canDeletePaper(paper)) {
    return;
  }

  event.preventDefault();
  state.readerContextMenu = {
    action: "delete-paper",
    paperId,
    x: event.clientX,
    y: event.clientY,
  };
  renderReaderContextMenu();
}

async function handleDeletePaper() {
  if (!state.currentUser || !state.selectedPaper) {
    return;
  }

  const paper = state.selectedPaper;

  if (!canDeletePaper(paper)) {
    window.alert("你只能删除自己上传的文献，管理员 admin 可删除任意文献。");
    return;
  }

  const confirmed = window.confirm(
    `确定删除文献“${truncate(paper.title || "未命名文献", 60)}”吗？该文献下的全部批注也会一起删除。`
  );

  if (!confirmed) {
    return;
  }

  const nextPaperId = getNextPaperIdAfterDeletion(paper.id);

  try {
    await apiRequest(`/api/papers/${encodeURIComponent(paper.id)}`, {
      method: "DELETE",
    });
    await refreshPapers();
    await refreshMyDashboard();
    await refreshMembersData();
    state.paperFormStatus = "文献已删除";

    if (nextPaperId && state.papers.some((item) => item.id === nextPaperId)) {
      await selectPaper(nextPaperId);
    } else {
      resetPaperSelection();
      writePaperIdToHash("");
    }

    render();
  } catch (error) {
    console.error("Failed to delete paper.", error);
    window.alert(error.message || "删除文献失败，请稍后再试。");
  }
}

async function handleDeletePaperById(paperId) {
  const paper = state.papers.find((item) => item.id === paperId);

  if (!state.currentUser || !paper) {
    return;
  }

  if (!canDeletePaper(paper)) {
    window.alert("你只能删除自己上传的文献，管理员 admin 可删除任意文献。");
    return;
  }

  const confirmed = window.confirm(
    `确定删除文献“${truncate(paper.title || "未命名文献", 60)}”吗？该文献下的全部批注也会一起删除。`
  );

  if (!confirmed) {
    return;
  }

  const nextPaperId = getNextPaperIdAfterDeletion(paper.id);

  try {
    await apiRequest(`/api/papers/${encodeURIComponent(paper.id)}`, {
      method: "DELETE",
    });
    await refreshPapers();
    await refreshMyDashboard();
    await refreshMembersData();
    state.paperFormStatus = "文献已删除";

    if (state.selectedPaperId === paper.id) {
      if (nextPaperId && state.papers.some((item) => item.id === nextPaperId)) {
        await selectPaper(nextPaperId);
      } else {
        resetPaperSelection();
        writePaperIdToHash("");
      }
    }

    render();
  } catch (error) {
    console.error("Failed to delete paper.", error);
    window.alert(error.message || "删除文献失败，请稍后再试。");
  }
}

async function handlePasswordSubmit(event) {
  event.preventDefault();

  if (!state.currentUser || state.isChangingPassword) {
    return;
  }

  const currentPassword = currentPasswordInput.value;
  const nextPassword = nextPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!currentPassword || !nextPassword || !confirmPassword) {
    state.passwordStatus = "请完整填写三个密码字段";
    renderAccountSettings();
    return;
  }

  if (nextPassword !== confirmPassword) {
    state.passwordStatus = "两次输入的新密码不一致";
    renderAccountSettings();
    return;
  }

  state.isChangingPassword = true;
  state.passwordStatus = "正在更新密码...";
  renderAccountSettings();

  try {
    await apiRequest("/api/me/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword,
        nextPassword,
      }),
    });
    passwordForm.reset();
    state.passwordStatus = "密码更新成功";
  } catch (error) {
    console.error("Failed to change password.", error);
    state.passwordStatus = error.message || "修改密码失败";
  } finally {
    state.isChangingPassword = false;
    renderAccountSettings();
  }
}

async function handleUsernameSubmit(event) {
  event.preventDefault();

  if (!state.currentUser || state.isUpdatingUsername) {
    return;
  }

  const nextUsername = String(nextUsernameInput?.value || "").trim();

  if (!nextUsername) {
    state.usernameStatus = "请输入新的用户名";
    renderAccountSettings();
    return;
  }

  if (nextUsername === state.currentUser.username) {
    state.usernameStatus = "新用户名不能与当前用户名相同";
    renderAccountSettings();
    return;
  }

  state.isUpdatingUsername = true;
  state.usernameStatus = "正在更新用户名...";
  renderAccountSettings();

  try {
    const result = await apiRequest("/api/me/username", {
      method: "POST",
      body: JSON.stringify({
        username: nextUsername,
      }),
    });

    state.currentUser = result.user || state.currentUser;
    storeCurrentUser(state.currentUser);
    state.loginStatus = `已登录为 ${state.currentUser.username}`;
    usernameForm?.reset();
    await refreshPapers();
    await refreshMyDashboard();
    await refreshMembersData();
    if (state.selectedPaperId) {
      await refreshSelectedPaperAnnotations();
      await refreshSelectedPaperDiscussions();
    }
    state.usernameStatus = "用户名更新成功";
    render();
  } catch (error) {
    console.error("Failed to change username.", error);
    state.usernameStatus = error.message || "修改用户名失败";
  } finally {
    state.isUpdatingUsername = false;
    renderAccountSettings();
  }
}

async function handleCreateUserSubmit(event) {
  event.preventDefault();

  if (!state.currentUser || !isCurrentUserAdmin() || state.isCreatingUser) {
    return;
  }

  const username = String(createUserUsernameInput?.value || "").trim();
  const password = String(createUserPasswordInput?.value || "");
  const confirmPassword = String(createUserConfirmPasswordInput?.value || "");

  if (!username || !password || !confirmPassword) {
    state.userManagementStatus = "请完整填写用户名和两次密码";
    renderUserManagement();
    return;
  }

  if (password !== confirmPassword) {
    state.userManagementStatus = "两次输入的初始密码不一致";
    renderUserManagement();
    return;
  }

  state.isCreatingUser = true;
  state.userManagementStatus = "正在创建用户...";
  renderUserManagement();

  try {
    await apiRequest("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
      }),
    });
    createUserForm?.reset();
    await refreshMembersData();
    state.userManagementStatus = `用户 ${username} 创建成功`;
    render();
  } catch (error) {
    console.error("Failed to create user.", error);
    state.userManagementStatus = error.message || "创建用户失败";
  } finally {
    state.isCreatingUser = false;
    renderUserManagement();
  }
}

async function handleManagedUserListClick(event) {
  const deleteButton = event.target.closest("[data-delete-user-id]");

  if (deleteButton) {
    await handleDeleteManagedUser(deleteButton.dataset.deleteUserId);
    return;
  }

  const transferButton = event.target.closest("[data-transfer-admin-user-id]");

  if (transferButton) {
    await handleTransferAdmin(transferButton.dataset.transferAdminUserId);
  }
}

async function handleDeleteManagedUser(userId) {
  if (!state.currentUser || !isCurrentUserAdmin() || state.isManagingUser || !userId) {
    return;
  }

  const targetUser = state.allUsers.find((user) => user.id === userId);

  if (!targetUser) {
    window.alert("要删除的用户不存在。");
    return;
  }

  const confirmed = window.confirm(
    `确认删除用户 ${targetUser.username} 吗？`
  );

  if (!confirmed) {
    return;
  }

  const shouldPurgeContent = window.confirm(
    [
      `是否一并删除 ${targetUser.username} 的历史上传和发言？`,
      "确定：删除账号，并一并删除该用户上传的文献、其历史发言，以及这些文献下的相关批注和讨论。",
      "取消：仅删除账号，保留历史上传和发言。",
    ].join("\n")
  );

  state.isManagingUser = true;
  state.managedUserActionUserId = userId;
  state.managedUserActionType = "delete";
  state.userManagementStatus = shouldPurgeContent
    ? `正在删除用户 ${targetUser.username}，并清理其历史上传和发言...`
    : `正在删除用户 ${targetUser.username}...`;
  renderUserManagement();

  try {
    const result = await apiRequest(
      `/api/users/${encodeURIComponent(userId)}${shouldPurgeContent ? "?purgeContent=1" : ""}`,
      {
      method: "DELETE",
      }
    );
    if (shouldPurgeContent) {
      await refreshPapers();
      await refreshMyDashboard();
      if (state.selectedPaperId) {
        if (state.papers.some((paper) => paper.id === state.selectedPaperId)) {
          await refreshSelectedPaperAnnotations();
          await refreshSelectedPaperDiscussions();
        } else {
          resetPaperSelection();
          writePaperIdToHash("");
        }
      }
    }
    await refreshMembersData();
    state.userManagementStatus = shouldPurgeContent
      ? `用户 ${targetUser.username} 已删除，同时清理了 ${
          Number(result?.deletedContent?.paperCount || 0)
        } 篇上传及相关的 ${Number(result?.deletedContent?.annotationCount || 0)} 条批注和 ${
          Number(result?.deletedContent?.discussionCount || 0)
        } 条讨论`
      : `用户 ${targetUser.username} 已删除，历史上传和发言已保留`;
    render();
  } catch (error) {
    console.error("Failed to delete user.", error);
    state.userManagementStatus = error.message || "删除用户失败";
  } finally {
    state.isManagingUser = false;
    state.managedUserActionUserId = "";
    state.managedUserActionType = "";
    renderUserManagement();
  }
}

async function handleTransferAdmin(userId) {
  if (!state.currentUser || !isCurrentUserAdmin() || state.isManagingUser || !userId) {
    return;
  }

  const targetUser = state.allUsers.find((user) => user.id === userId);

  if (!targetUser) {
    window.alert("要转让的目标用户不存在。");
    return;
  }

  const confirmed = window.confirm(
    `确认将管理员身份转让给 ${targetUser.username} 吗？转让后你将变为普通成员。`
  );

  if (!confirmed) {
    return;
  }

  state.isManagingUser = true;
  state.managedUserActionUserId = userId;
  state.managedUserActionType = "transfer";
  state.userManagementStatus = `正在将管理员身份转让给 ${targetUser.username}...`;
  renderUserManagement();

  try {
    const result = await apiRequest(`/api/users/${encodeURIComponent(userId)}/transfer-admin`, {
      method: "POST",
    });

    if (result.currentUser) {
      state.currentUser = result.currentUser;
      storeCurrentUser(state.currentUser);
      state.loginStatus = `已登录为 ${state.currentUser.username}`;
    }

    state.currentView = "profile";
    await refreshMyDashboard();
    await refreshMembersData();
    state.userManagementStatus = `管理员身份已转让给 ${targetUser.username}`;
    render();
  } catch (error) {
    console.error("Failed to transfer admin role.", error);
    state.userManagementStatus = error.message || "转让管理员失败";
  } finally {
    state.isManagingUser = false;
    state.managedUserActionUserId = "";
    state.managedUserActionType = "";
    renderUserManagement();
  }
}

async function handleMyAnnotationListClick(event) {
  const deleteButton = event.target.closest("[data-delete-my-speech-id]");

  if (deleteButton) {
    const speechType = deleteButton.dataset.speechType || "annotation";
    if (speechType === "discussion") {
      await handleDeleteDiscussionById(deleteButton.dataset.deleteMySpeechId);
    } else {
      await handleDeleteAnnotationById(deleteButton.dataset.deleteMySpeechId);
    }
    return;
  }

  const item = event.target.closest("[data-open-my-speech-id]");

  if (!item) {
    return;
  }

  await openSpeechLocation({
    speechType: item.dataset.speechType || "annotation",
    paperId: item.dataset.paperId,
    threadId: item.dataset.threadId,
    replyId: item.dataset.replyId || "",
  });
}

async function handleMemberListClick(event) {
  const item = event.target.closest("[data-member-id]");

  if (!item || item.dataset.memberId === state.selectedMemberId) {
    return;
  }

  state.selectedMemberId = item.dataset.memberId;
  state.selectedMemberProfile = null;
  state.memberProfilePanel = "papers";
  render();
  await refreshSelectedMemberProfile();
  render();
}

async function handleMyPaperListClick(event) {
  const deleteButton = event.target.closest("[data-delete-profile-paper-id]");

  if (deleteButton) {
    await handleDeletePaperById(deleteButton.dataset.deleteProfilePaperId);
    return;
  }

  const item = event.target.closest("[data-open-profile-paper-id]");

  if (!item) {
    return;
  }

  openPaperDetail({ paperId: item.dataset.openProfilePaperId, panel: "reader" });
}

async function handleMemberProfilePaperListClick(event) {
  const item = event.target.closest("[data-open-member-paper-id]");

  if (!item) {
    return;
  }

  openPaperDetail({ paperId: item.dataset.openMemberPaperId, panel: "reader" });
}

async function handleReceivedReplyListClick(event) {
  const item = event.target.closest("[data-open-received-speech-id]");

  if (!item) {
    return;
  }

  await openSpeechLocation({
    speechType: item.dataset.speechType || "annotation",
    paperId: item.dataset.paperId,
    threadId: item.dataset.threadId,
    replyId: item.dataset.replyId || "",
  });
}

async function handleMemberProfileAnnotationListClick(event) {
  const item = event.target.closest("[data-open-member-speech-id]");

  if (!item) {
    return;
  }

  await openSpeechLocation({
    speechType: item.dataset.speechType || "annotation",
    paperId: item.dataset.paperId,
    threadId: item.dataset.threadId,
    replyId: item.dataset.replyId || "",
  });
}

function handleGlobalPointerDown(event) {
  if (!state.readerContextMenu) {
    return;
  }

  if (event.target.closest("#reader-context-menu")) {
    return;
  }

  closeReaderContextMenu();
}

function handleGlobalKeyDown(event) {
  if (event.key !== "Escape" || !state.readerContextMenu) {
    return;
  }

  closeReaderContextMenu();
}

function handleGlobalViewportChange() {
  if (state.readerContextMenu) {
    closeReaderContextMenu();
  }
  if (window.matchMedia("(min-width: 981px)").matches) {
    queueScrollPaneLayout();
  }
}

function handleReaderContextMenuOpen(event) {
  if (!state.currentUser || !state.selectedPaper || state.currentView !== "library") {
    closeReaderContextMenu();
    return;
  }

  const pendingHighlight = event.target.closest(".pending-selection-highlight");

  if (pendingHighlight && state.pendingSelection) {
    event.preventDefault();
    state.readerContextMenu = {
      action: "cancel-pending",
      x: event.clientX,
      y: event.clientY,
    };
    renderReaderContextMenu();
    return;
  }

  const highlight = event.target.closest(".annotation-highlight");

  if (highlight?.dataset?.annotationId) {
    event.preventDefault();
    state.selectedAnnotationId = highlight.dataset.annotationId;
    state.selectedReplyId = null;
    state.annotationNavigationTargetId = highlight.dataset.annotationId;
    renderAnnotationList();
    renderAnnotationDetail();
    renderReplyComposer();
    syncActiveHighlight();
    state.readerContextMenu = {
      action: "delete-annotation",
      annotationId: highlight.dataset.annotationId,
      x: event.clientX,
      y: event.clientY,
    };
    renderReaderContextMenu();
    return;
  }

  const pendingSelection = readPendingSelectionFromWindowSelection();

  if (!pendingSelection) {
    closeReaderContextMenu();
    return;
  }

  event.preventDefault();
  state.readerContextMenu = {
    action: "create-annotation",
    pendingSelection,
    x: event.clientX,
    y: event.clientY,
  };
  renderReaderContextMenu();
}

async function handleReaderContextMenuClick(event) {
  const actionButton = event.target.closest("[data-reader-context-action]");

  if (!actionButton || actionButton.disabled) {
    return;
  }

  const menu = getRenderableReaderContextMenu();
  closeReaderContextMenu();

  if (!menu) {
    return;
  }

  if (menu.action === "create-annotation") {
    state.pendingSelection = menu.pendingSelection;
    syncPendingSelectionHighlight();
    renderSelectionPanel();
    window.getSelection()?.removeAllRanges();
    focusAnnotationComposer();
    return;
  }

  if (menu.action === "cancel-pending") {
    handleCancelPendingAnnotation();
    return;
  }

  if (menu.action === "delete-annotation" && menu.annotationId) {
    state.selectedAnnotationId = menu.annotationId;
    state.selectedReplyId = null;
    state.annotationNavigationTargetId = menu.annotationId;
    renderAnnotationList();
    renderAnnotationDetail();
    renderReplyComposer();
    syncActiveHighlight();
    await handleDeleteAnnotation();
    return;
  }

  if (menu.action === "delete-paper" && menu.paperId) {
    await handleDeletePaperById(menu.paperId);
  }
}

function closeReaderContextMenu() {
  if (!state.readerContextMenu) {
    return;
  }

  state.readerContextMenu = null;
  renderReaderContextMenu();
}

function getRenderableReaderContextMenu() {
  const menu = state.readerContextMenu;

  if (!menu || state.currentView !== "library") {
    return null;
  }

  if (!state.selectedPaper && menu.action !== "delete-paper") {
    return null;
  }

  if (menu.action === "create-annotation") {
    if (!menu.pendingSelection || !hasAvailableAnnotatableContent()) {
      return null;
    }

    return {
      ...menu,
      label: `新建${getAnnotationScopeLabel(menu.pendingSelection.target_scope)}批注`,
      danger: false,
      disabled: !state.serverReady || !state.currentUser || state.isSavingAnnotation,
    };
  }

  if (menu.action === "cancel-pending") {
    if (!state.pendingSelection) {
      return null;
    }

    return {
      ...menu,
      label: "取消临时高亮",
      danger: true,
      disabled: state.isSavingAnnotation,
    };
  }

  if (menu.action === "delete-annotation") {
    const annotation = getAnnotationById(menu.annotationId);

    if (!annotation || isReplyAnnotation(annotation)) {
      return null;
    }

    return {
      ...menu,
      label: canDeleteAnnotation(annotation) ? "删除批注" : "无权限删除此批注",
      danger: true,
      disabled: !canDeleteAnnotation(annotation),
    };
  }

  if (menu.action === "delete-paper") {
    const paper = state.papers.find((entry) => entry.id === menu.paperId);

    if (!paper) {
      return null;
    }

    return {
      ...menu,
      label: canDeletePaper(paper) ? "删除文章" : "无权限删除此文章",
      danger: true,
      disabled: !canDeletePaper(paper),
    };
  }

  return null;
}

function focusAnnotationComposer() {
  annotationInput.focus();
  annotationInput.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest",
  });
  syncComposerTextareaState({ currentTarget: annotationInput });
}

function capturePendingSelectionForComposer() {
  if (!state.selectedPaper || !hasAvailableAnnotatableContent()) {
    closeReaderContextMenu();
    clearPendingSelection();
    syncPendingSelectionHighlight();
    renderSelectionPanel();
    return;
  }

  const pendingSelection = readPendingSelectionFromWindowSelection();

  if (pendingSelection) {
    state.pendingSelection = pendingSelection;
  }

  syncPendingSelectionHighlight();
  renderSelectionPanel();
}

function clearPendingSelection() {
  state.pendingSelection = null;
}

function handleCancelPendingAnnotation() {
  if (!state.pendingSelection) {
    return;
  }

  closeReaderContextMenu();
  clearPendingSelection();
  annotationInput.value = "";
  clearComposerAttachments(annotationAttachmentsInput);
  syncPendingSelectionHighlight();
  window.getSelection()?.removeAllRanges();
  syncComposerTextareaState({ currentTarget: annotationInput });
  renderSelectionPanel();
}

async function handleAddAnnotation() {
  if (
    !state.serverReady ||
    !state.currentUser ||
    !state.selectedPaper ||
    !hasAvailableAnnotatableContent() ||
    !state.pendingSelection
  ) {
    return;
  }

  closeReaderContextMenu();
  const note = annotationInput.value.trim();
  let attachments = [];

  try {
    attachments = await readAttachmentPayloads(annotationAttachmentsInput);
  } catch (error) {
    window.alert(error.message || "附件读取失败，请重新选择后再试。");
    return;
  }

  if (!note && attachments.length === 0) {
    window.alert("请先填写批注内容或选择附件。");
    annotationInput.focus();
    return;
  }

  const overlapsExisting = state.annotations.some(
    (annotation) =>
      !isReplyAnnotation(annotation) &&
      normalizeAnnotationScope(annotation.target_scope) ===
        normalizeAnnotationScope(state.pendingSelection.target_scope) &&
      state.pendingSelection.start_offset < annotation.end_offset &&
      state.pendingSelection.end_offset > annotation.start_offset
  );

  if (overlapsExisting) {
    window.alert("当前版本暂不支持重叠批注，请换一段未高亮的文本再试。");
    return;
  }

  state.isSavingAnnotation = true;
  renderSelectionPanel();

  try {
    const formData = createSpeechFormData({
      note,
      attachments,
      selection: state.pendingSelection,
    });
    const annotation = await apiRequest(
      `/api/papers/${encodeURIComponent(state.selectedPaper.id)}/annotations`,
      {
        method: "POST",
        body: formData,
      }
    );

    state.annotations = [...state.annotations, annotation].sort(compareAnnotationsForDisplay);
    state.selectedAnnotationId = annotation.id;
    state.selectedReplyId = null;
    state.annotationNavigationTargetId = annotation.id;
    clearPendingSelection();
    annotationInput.value = "";
    clearComposerAttachments(annotationAttachmentsInput);
    window.getSelection()?.removeAllRanges();
    await refreshMyDashboard();
    await refreshMembersData();
    render();
  } catch (error) {
    console.error("Failed to save annotation.", error);
    window.alert(error.message || "批注保存失败，请稍后重试。");
  } finally {
    state.isSavingAnnotation = false;
    renderSelectionPanel();
  }
}

function getSpeechInteractionOptions(kind) {
  if (kind === "discussion") {
    return {
      addReplyRender: renderDiscussionReplyComposer,
      apiBasePath: "/api/discussions",
      canDelete: canDeleteDiscussion,
      canEdit: canEditDiscussion,
      deletePermissionMessage: "你只能删除自己的讨论，管理员 admin 可删除任意讨论。",
      detailRender: renderDiscussionDetail,
      editPermissionMessage: "你只能编辑自己的讨论，管理员 admin 可编辑任意讨论。",
      editState: state.discussionEditState,
      focusEditor: focusDiscussionDetailEditor,
      getActiveReplyTarget: getActiveDiscussionReplyTarget,
      getRecords: () => state.discussions,
      getSelectedThread: getSelectedDiscussionThread,
      getTopLevelRecords: getTopLevelDiscussions,
      kind,
      listRender: renderDiscussionList,
      navigationKey: "discussionNavigationTargetId",
      recordsKey: "discussions",
      replyAddFailureMessage: "回复失败，请稍后重试。",
      replyAddSuccessInput: discussionReplyInput,
      replyAttachmentsInput: discussionReplyAttachmentsInput,
      replyDeleteConfirmMessage: "确定删除这条回复吗？",
      replyDeleteFailureMessage: "删除回复失败，请稍后再试。",
      replyDeletePermissionMessage: "你只能删除自己的回复，管理员 admin 可删除任意讨论。",
      replyEditPermissionMessage: "你只能编辑自己的回复，管理员 admin 可编辑任意讨论。",
      replyInput: discussionReplyInput,
      replyPermissionEmptyMessage: "请先填写回复内容或选择附件。",
      replySavingKey: "isSavingDiscussionReply",
      selectedReplyKey: "selectedDiscussionReplyId",
      selectedThreadKey: "selectedDiscussionId",
      sortRecords: compareDiscussionsForDisplay,
      threadDeleteConfirmMessage: "确定删除该讨论吗？",
      threadDeleteFailureMessage: "删除讨论失败，请稍后再试。",
      threadDeleteScope: "discussion",
      threadRootId: getThreadRootDiscussionId,
    };
  }

  return {
    addReplyRender: renderReplyComposer,
    apiBasePath: "/api/annotations",
    canDelete: canDeleteAnnotation,
    canEdit: canEditAnnotation,
    deletePermissionMessage: "你只能删除自己的批注，管理员 admin 可删除任意批注。",
    detailRender: renderAnnotationDetail,
    editPermissionMessage: "你只能编辑自己的批注，管理员 admin 可编辑任意批注。",
    editState: state.annotationEditState,
    focusEditor: focusAnnotationDetailEditor,
    getActiveReplyTarget: getActiveReplyTargetAnnotation,
    getRecords: () => state.annotations,
    getSelectedThread: getSelectedThreadAnnotation,
    getTopLevelRecords: getTopLevelAnnotations,
    kind,
    listRender: renderAnnotationList,
    navigationKey: "annotationNavigationTargetId",
    recordsKey: "annotations",
    replyAddFailureMessage: "回复失败，请稍后重试。",
    replyAddSuccessInput: replyInput,
    replyAttachmentsInput: replyAttachmentsInput,
    replyDeleteConfirmMessage: "确定删除这条回复吗？",
    replyDeleteFailureMessage: "删除回复失败，请稍后再试。",
    replyDeletePermissionMessage: "你只能删除自己的回复，管理员 admin 可删除任意批注。",
    replyEditPermissionMessage: "你只能编辑自己的回复，管理员 admin 可编辑任意批注。",
    replyInput,
    replyPermissionEmptyMessage: "请先填写回复内容或选择附件。",
    replySavingKey: "isSavingReply",
    selectedReplyKey: "selectedReplyId",
    selectedThreadKey: "selectedAnnotationId",
    sortRecords: compareAnnotationsForDisplay,
    threadDeleteConfirmMessage: "确定删除该批注吗？",
    threadDeleteFailureMessage: "删除批注失败，请稍后再试。",
    threadDeleteScope: "annotation",
    threadRootId: getThreadRootAnnotationId,
  };
}

function startSpeechEdit(kind, record, targetType) {
  const interactionOptions = getSpeechInteractionOptions(kind);
  const nextEditState = {
    targetId: record.id,
    targetType,
    draft: record.note || "",
    attachments: createEditableAttachmentItems(record.attachments),
    isSaving: false,
  };

  if (kind === "discussion") {
    state.discussionEditState = nextEditState;
    if (targetType === "reply") {
      state.selectedDiscussionReplyId = record.id;
    }
  } else {
    state.annotationEditState = nextEditState;
    if (targetType === "reply") {
      state.selectedReplyId = record.id;
    }
  }

  interactionOptions.detailRender();
  interactionOptions.focusEditor();
}

function selectSpeechThread(kind, threadId) {
  const interactionOptions = getSpeechInteractionOptions(kind);
  state[interactionOptions.selectedThreadKey] = threadId;
  state[interactionOptions.selectedReplyKey] = null;
  state[interactionOptions.navigationKey] = threadId;
  if (kind === "discussion") {
    resetDiscussionEditState();
  } else {
    resetAnnotationEditState();
  }
  interactionOptions.listRender();
  interactionOptions.detailRender();
  interactionOptions.addReplyRender();
  if (kind === "annotation") {
    syncActiveHighlight();
    flushPendingAnnotationNavigation();
  } else {
    flushPendingDiscussionNavigation();
  }
}

async function handleDeleteSpeech(kind) {
  const interactionOptions = getSpeechInteractionOptions(kind);
  const record = interactionOptions
    .getTopLevelRecords()
    .find((item) => item.id === state[interactionOptions.selectedThreadKey]);

  if (!record) {
    return;
  }

  if (kind === "annotation") {
    closeReaderContextMenu();
  }

  if (!interactionOptions.canDelete(record)) {
    window.alert(interactionOptions.deletePermissionMessage);
    return;
  }

  if (!window.confirm(interactionOptions.threadDeleteConfirmMessage)) {
    return;
  }

  try {
    await apiRequest(`${interactionOptions.apiBasePath}/${encodeURIComponent(record.id)}`, {
      method: "DELETE",
    });
    state[interactionOptions.recordsKey] = state[interactionOptions.recordsKey].filter(
      (item) => interactionOptions.threadRootId(item) !== record.id
    );
    state[interactionOptions.selectedThreadKey] = null;
    state[interactionOptions.selectedReplyKey] = null;
    state[interactionOptions.navigationKey] = null;

    if (kind === "discussion") {
      if (discussionReplyInput) {
        discussionReplyInput.value = "";
      }
      clearComposerAttachments(discussionReplyAttachmentsInput);
    } else {
      replyInput.value = "";
      clearComposerAttachments(replyAttachmentsInput);
    }

    await refreshMyDashboard();
    await refreshMembersData();
    render();
  } catch (error) {
    console.error(`Failed to delete ${interactionOptions.threadDeleteScope}.`, error);
    window.alert(error.message || interactionOptions.threadDeleteFailureMessage);
  }
}

function handleEditSpeech(kind) {
  const interactionOptions = getSpeechInteractionOptions(kind);
  const record = interactionOptions
    .getTopLevelRecords()
    .find((item) => item.id === state[interactionOptions.selectedThreadKey]);

  if (!record) {
    return;
  }

  if (kind === "annotation") {
    closeReaderContextMenu();
  }

  if (!interactionOptions.canEdit(record)) {
    window.alert(interactionOptions.editPermissionMessage);
    return;
  }

  if (
    interactionOptions.editState.targetId === record.id &&
    interactionOptions.editState.targetType === kind
  ) {
    interactionOptions.focusEditor();
    return;
  }

  startSpeechEdit(kind, record, kind);
}

async function handleAddSpeechReply(kind) {
  const interactionOptions = getSpeechInteractionOptions(kind);
  const selectedRecord = interactionOptions.getSelectedThread();
  const replyTarget = interactionOptions.getActiveReplyTarget();

  if (
    !state.serverReady ||
    !state.currentUser ||
    !selectedRecord ||
    !replyTarget ||
    interactionOptions.replyInput == null ||
    state[interactionOptions.replySavingKey]
  ) {
    return;
  }

  const note = interactionOptions.replyInput.value.trim();
  let attachments = [];

  try {
    attachments = await readAttachmentPayloads(interactionOptions.replyAttachmentsInput);
  } catch (error) {
    window.alert(error.message || "附件读取失败，请重新选择后再试。");
    return;
  }

  if (!note && attachments.length === 0) {
    window.alert(interactionOptions.replyPermissionEmptyMessage);
    interactionOptions.replyInput.focus();
    return;
  }

  state[interactionOptions.replySavingKey] = true;
  interactionOptions.addReplyRender();

  try {
    const formData = createSpeechFormData({ note, attachments });
    const reply = await apiRequest(
      `${interactionOptions.apiBasePath}/${encodeURIComponent(replyTarget.id)}/replies`,
      {
        method: "POST",
        body: formData,
      }
    );

    state[interactionOptions.recordsKey] = [...state[interactionOptions.recordsKey], reply].sort(
      interactionOptions.sortRecords
    );
    state[interactionOptions.selectedReplyKey] = reply.id;
    interactionOptions.replyAddSuccessInput.value = "";
    clearComposerAttachments(interactionOptions.replyAttachmentsInput);
    await refreshMyDashboard();
    await refreshMembersData();
    render();
  } catch (error) {
    console.error(`Failed to save ${kind} reply.`, error);
    window.alert(error.message || interactionOptions.replyAddFailureMessage);
  } finally {
    state[interactionOptions.replySavingKey] = false;
    interactionOptions.addReplyRender();
  }
}

async function handleDeleteAnnotation() {
  await handleDeleteSpeech("annotation");
}

async function handleEditAnnotation() {
  handleEditSpeech("annotation");
}

async function handleDeleteDiscussion() {
  await handleDeleteSpeech("discussion");
}

async function handleEditDiscussion() {
  handleEditSpeech("discussion");
}

async function handleDeleteAnnotationById(annotationId) {
  const annotation = state.myAnnotations.find((item) => item.id === annotationId);

  if (!annotation) {
    return;
  }

  if (!canDeleteAnnotation(annotation)) {
    window.alert("你只能删除自己的发言，管理员 admin 可删除任意批注。");
    return;
  }

  const confirmed = window.confirm(`确定删除这条${annotation.is_reply ? "回复" : "发言"}吗？`);

  if (!confirmed) {
    return;
  }

  try {
    await apiRequest(`/api/annotations/${encodeURIComponent(annotation.id)}`, {
      method: "DELETE",
    });

    if (state.selectedPaperId === annotation.paperId) {
      await refreshSelectedPaperAnnotations();
    }

    if (state.selectedAnnotationId === annotation.id) {
      state.selectedAnnotationId = null;
      state.selectedReplyId = null;
      state.annotationNavigationTargetId = null;
    }

    if (state.selectedReplyId === annotation.id) {
      state.selectedReplyId = null;
    }

    await refreshMyDashboard();
    await refreshMembersData();
    render();
  } catch (error) {
    console.error("Failed to delete annotation from profile panel.", error);
    window.alert(error.message || "删除发言失败，请稍后再试。");
  }
}

async function handleDeleteDiscussionById(discussionId) {
  const discussion = state.myAnnotations.find((item) => item.id === discussionId);

  if (!discussion) {
    return;
  }

  if (!canDeleteDiscussion(discussion)) {
    window.alert("你只能删除自己的发言，管理员 admin 可删除任意讨论。");
    return;
  }

  const confirmed = window.confirm(`确定删除这条${discussion.is_reply ? "回复" : "讨论"}吗？`);

  if (!confirmed) {
    return;
  }

  try {
    await apiRequest(`/api/discussions/${encodeURIComponent(discussion.id)}`, {
      method: "DELETE",
    });

    if (state.selectedPaperId === discussion.paperId) {
      await refreshSelectedPaperDiscussions();
    }

    if (state.selectedDiscussionId === discussion.id) {
      state.selectedDiscussionId = null;
      state.selectedDiscussionReplyId = null;
      state.discussionNavigationTargetId = null;
    }

    if (state.selectedDiscussionReplyId === discussion.id) {
      state.selectedDiscussionReplyId = null;
    }

    await refreshMyDashboard();
    await refreshMembersData();
    render();
  } catch (error) {
    console.error("Failed to delete discussion from profile panel.", error);
    window.alert(error.message || "删除讨论失败，请稍后再试。");
  }
}

async function handleClearAnnotations() {
  if (!state.currentUser || !state.selectedPaper) {
    return;
  }

  const ownAnnotations = getOwnAnnotationsForSelectedPaper();

  if (!ownAnnotations.length) {
    window.alert("当前文献下还没有你自己的批注可清空。");
    return;
  }

  const confirmed = window.confirm("确定要清空你在当前文献下创建的全部批注吗？");

  if (!confirmed) {
    return;
  }

  try {
    await apiRequest(`/api/papers/${encodeURIComponent(state.selectedPaper.id)}/annotations`, {
      method: "DELETE",
    });
    const ownAnnotationIds = new Set(ownAnnotations.map((annotation) => annotation.id));
    state.annotations = state.annotations.filter((annotation) => {
      const threadRootId = getThreadRootAnnotationId(annotation);
      return !ownAnnotationIds.has(annotation.id) && !ownAnnotationIds.has(threadRootId);
    });
    clearPendingSelection();
    if (ownAnnotationIds.has(state.selectedAnnotationId)) {
      state.selectedAnnotationId = null;
      state.selectedReplyId = null;
    }
    if (ownAnnotationIds.has(state.selectedReplyId)) {
      state.selectedReplyId = null;
    }
    annotationInput.value = "";
    replyInput.value = "";
    clearComposerAttachments(annotationAttachmentsInput);
    clearComposerAttachments(replyAttachmentsInput);
    window.getSelection()?.removeAllRanges();
    await refreshMyDashboard();
    await refreshMembersData();
    render();
  } catch (error) {
    console.error("Failed to clear annotations.", error);
    window.alert(error.message || "清空批注失败，请稍后再试。");
  }
}

function handleHighlightClick(event) {
  const highlight = event.target.closest("[data-annotation-id]");

  if (!highlight) {
    return;
  }

  state.selectedAnnotationId = highlight.dataset.annotationId;
  state.selectedReplyId = null;
  state.annotationNavigationTargetId = highlight.dataset.annotationId;
  resetAnnotationEditState();
  renderAnnotationList();
  renderAnnotationDetail();
  renderReplyComposer();
  syncActiveHighlight();
  flushPendingAnnotationNavigation();
}

function handleSpeechListClick(kind, event) {
  const selector = kind === "discussion" ? "[data-discussion-id]" : "[data-annotation-id]";
  const item = event.target.closest(selector);

  if (!item) {
    return;
  }

  selectSpeechThread(kind, kind === "discussion" ? item.dataset.discussionId : item.dataset.annotationId);
}

function handleAnnotationListClick(event) {
  handleSpeechListClick("annotation", event);
}

async function handleSpeechDetailClick(kind, event) {
  const interactionOptions = getSpeechInteractionOptions(kind);
  const clearAttachmentsButton = event.target.closest(`[data-clear-${kind}-edit-attachments]`);

  if (clearAttachmentsButton) {
    clearDetailEditAttachments(kind);
    return;
  }

  const removeAttachmentButton = event.target.closest(
    kind === "discussion"
      ? "[data-remove-discussion-edit-attachment-key]"
      : "[data-remove-annotation-edit-attachment-key]"
  );

  if (removeAttachmentButton) {
    removeDetailEditAttachmentByKey(
      kind,
      kind === "discussion"
        ? removeAttachmentButton.dataset.removeDiscussionEditAttachmentKey || ""
        : removeAttachmentButton.dataset.removeAnnotationEditAttachmentKey || ""
    );
    return;
  }

  if (event.target.closest(`[data-save-${kind}-edit]`)) {
    await saveSpeechDetailEdit(kind);
    return;
  }

  if (event.target.closest(`[data-cancel-${kind}-edit]`)) {
    if (kind === "discussion") {
      resetDiscussionEditState();
    } else {
      resetAnnotationEditState();
    }
    interactionOptions.detailRender();
    return;
  }

  const editReplyButton = event.target.closest(
    kind === "discussion" ? "[data-edit-discussion-reply-id]" : "[data-edit-reply-id]"
  );

  if (editReplyButton) {
    const replyId =
      kind === "discussion"
        ? editReplyButton.dataset.editDiscussionReplyId
        : editReplyButton.dataset.editReplyId;
    const reply = interactionOptions.getRecords().find((item) => item.id === replyId);

    if (!reply) {
      return;
    }

    if (!interactionOptions.canEdit(reply)) {
      window.alert(interactionOptions.replyEditPermissionMessage);
      return;
    }

    if (
      interactionOptions.editState.targetId === reply.id &&
      interactionOptions.editState.targetType === "reply"
    ) {
      interactionOptions.focusEditor();
      return;
    }

    startSpeechEdit(kind, reply, "reply");
    return;
  }

  const deleteReplyButton = event.target.closest(
    kind === "discussion" ? "[data-delete-discussion-reply-id]" : "[data-delete-reply-id]"
  );

  if (deleteReplyButton) {
    const replyId =
      kind === "discussion"
        ? deleteReplyButton.dataset.deleteDiscussionReplyId
        : deleteReplyButton.dataset.deleteReplyId;
    const reply = interactionOptions.getRecords().find((item) => item.id === replyId);

    if (!reply) {
      return;
    }

    if (!interactionOptions.canDelete(reply)) {
      window.alert(interactionOptions.replyDeletePermissionMessage);
      return;
    }

    if (!window.confirm(interactionOptions.replyDeleteConfirmMessage)) {
      return;
    }

    try {
      await apiRequest(`${interactionOptions.apiBasePath}/${encodeURIComponent(reply.id)}`, {
        method: "DELETE",
      });
      if (kind === "discussion") {
        await refreshSelectedPaperDiscussions();
      } else {
        await refreshSelectedPaperAnnotations();
      }
      if (state[interactionOptions.selectedReplyKey] === reply.id) {
        state[interactionOptions.selectedReplyKey] = null;
      }
      await refreshMyDashboard();
      await refreshMembersData();
      render();
    } catch (error) {
      console.error(`Failed to delete ${kind} reply.`, error);
      window.alert(error.message || interactionOptions.replyDeleteFailureMessage);
    }

    return;
  }

  const replyCard = event.target.closest(
    kind === "discussion" ? "[data-discussion-reply-id]" : "[data-reply-id]"
  );

  if (!replyCard) {
    return;
  }

  state[interactionOptions.selectedReplyKey] =
    kind === "discussion"
      ? replyCard.dataset.discussionReplyId
      : replyCard.dataset.replyId;
  interactionOptions.detailRender();
  interactionOptions.addReplyRender();
  renderMyAnnotationList();
  renderReceivedReplyList();
  if (kind === "discussion") {
    flushPendingDiscussionNavigation();
  } else {
    flushPendingAnnotationNavigation();
  }
}

async function handleAnnotationDetailClick(event) {
  await handleSpeechDetailClick("annotation", event);
}

function handleAnnotationDetailChange(event) {
  const attachmentInput = event.target.closest("#annotation-detail-attachments");
  if (attachmentInput) {
    handleDetailEditAttachmentInputChange("annotation", attachmentInput);
  }
}

async function handleAddReply() {
  await handleAddSpeechReply("annotation");
}

function handleDiscussionInputChange(event) {
  syncComposerTextareaState(event);
  renderDiscussionComposer();
}

function handleCancelDiscussion() {
  if (!discussionInput) {
    return;
  }

  discussionInput.value = "";
  clearComposerAttachments(discussionAttachmentsInput);
  syncComposerTextareaState({ currentTarget: discussionInput });
  renderDiscussionComposer();
}

async function handleAddDiscussion() {
  if (
    !state.serverReady ||
    !state.currentUser ||
    !state.selectedPaper ||
    !discussionInput ||
    state.isSavingDiscussion
  ) {
    return;
  }

  const note = discussionInput.value.trim();
  let attachments = [];

  try {
    attachments = await readAttachmentPayloads(discussionAttachmentsInput);
  } catch (error) {
    window.alert(error.message || "附件读取失败，请重新选择后再试。");
    return;
  }

  if (!note && attachments.length === 0) {
    window.alert("请先填写讨论内容或选择附件。");
    discussionInput.focus();
    return;
  }

  state.isSavingDiscussion = true;
  renderDiscussionComposer();

  try {
    const formData = createSpeechFormData({ note, attachments });
    const discussion = await apiRequest(
      `/api/papers/${encodeURIComponent(state.selectedPaper.id)}/discussions`,
      {
        method: "POST",
        body: formData,
      }
    );

    state.discussions = [...state.discussions, discussion].sort(compareDiscussionsForDisplay);
    state.selectedDiscussionId = discussion.id;
    state.selectedDiscussionReplyId = null;
    state.discussionNavigationTargetId = discussion.id;
    discussionInput.value = "";
    clearComposerAttachments(discussionAttachmentsInput);
    await refreshMyDashboard();
    await refreshMembersData();
    render();
  } catch (error) {
    console.error("Failed to save discussion.", error);
    window.alert(error.message || "讨论发布失败，请稍后重试。");
  } finally {
    state.isSavingDiscussion = false;
    renderDiscussionComposer();
  }
}

function handleDiscussionListClick(event) {
  handleSpeechListClick("discussion", event);
}

async function handleDiscussionDetailClick(event) {
  await handleSpeechDetailClick("discussion", event);
}

function handleDiscussionDetailChange(event) {
  const attachmentInput = event.target.closest("#discussion-detail-attachments");
  if (attachmentInput) {
    handleDetailEditAttachmentInputChange("discussion", attachmentInput);
  }
}

async function handleAddDiscussionReply() {
  await handleAddSpeechReply("discussion");
}

async function handleHashChange() {
  if (IS_CATALOG_PAGE) {
    return;
  }

  if (!state.currentUser) {
    return;
  }

  const paperId = readPaperIdFromHash();

  if (!paperId || paperId === state.selectedPaperId) {
    return;
  }

  if (!state.papers.some((paper) => paper.id === paperId)) {
    return;
  }

  state.currentView = "library";
  await selectPaper(paperId, { updateHash: false });
  render();
}

async function selectPaper(paperId, options = {}) {
  if (!state.currentUser) {
    return;
  }

  const {
    updateHash = true,
    focusAnnotationId = "",
    focusReplyId = "",
    focusDiscussionId = "",
    focusDiscussionReplyId = "",
  } = options;
  const paper = state.papers.find((item) => item.id === paperId);

  if (!paper) {
    return;
  }

  state.selectedPaperId = paper.id;
  state.selectedPaper = paper;
  state.articleLoaded = false;
  state.articleHtml = "";
  state.readerContextMenu = null;
  clearPendingSelection();
  state.selectedAnnotationId = null;
  state.selectedReplyId = null;
  state.annotations = [];
  state.selectedDiscussionId = null;
  state.selectedDiscussionReplyId = null;
  state.discussionNavigationTargetId = null;
  state.discussions = [];
  clearComposerAttachments(annotationAttachmentsInput);
  clearComposerAttachments(replyAttachmentsInput);
  clearComposerAttachments(discussionAttachmentsInput);
  clearComposerAttachments(discussionReplyAttachmentsInput);
  window.getSelection()?.removeAllRanges();
  render();

  const [paperDetail, annotations, discussions] = await Promise.all([
    apiRequest(`/api/papers/${encodeURIComponent(paper.id)}`),
    apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/annotations`),
    apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/discussions`),
  ]);

  state.selectedPaper = paperDetail;
  state.annotations = annotations.sort(compareAnnotationsForDisplay);
  state.discussions = discussions.sort(compareDiscussionsForDisplay);
  state.selectedAnnotationId = getTopLevelAnnotations().some(
    (annotation) => annotation.id === focusAnnotationId
  )
    ? focusAnnotationId
    : null;
  state.selectedReplyId = state.annotations.some((annotation) => annotation.id === focusReplyId)
    ? focusReplyId
    : null;
  state.annotationNavigationTargetId = state.selectedAnnotationId;
  state.selectedDiscussionId = getTopLevelDiscussions().some(
    (discussion) => discussion.id === focusDiscussionId
  )
    ? focusDiscussionId
    : null;
  state.selectedDiscussionReplyId = state.discussions.some(
    (discussion) => discussion.id === focusDiscussionReplyId
  )
    ? focusDiscussionReplyId
    : null;
  state.discussionNavigationTargetId = state.selectedDiscussionId;

  if (paperDetail.hasSnapshot) {
    const content = await apiRequest(`/api/papers/${encodeURIComponent(paper.id)}/content`);
    state.articleHtml = extractReadableArticleHtml(content.rawHtml, paperDetail.sourceUrl, {
      allowImages: isArticleImagesEnabledForPaper(paperDetail),
    });
  }

  state.articleLoaded = true;

  if (updateHash) {
    writePaperIdToHash(paper.id);
  }
}

async function refreshPapers() {
  if (!state.currentUser) {
    state.papers = [];
    state.selectedPaper = null;
    return;
  }

  state.papers = (await apiRequest("/api/papers")).sort(comparePapersForList);

  if (state.selectedPaperId) {
    state.selectedPaper =
      state.papers.find((paper) => paper.id === state.selectedPaperId) || null;
  }
}

async function refreshMyDashboard() {
  if (!state.currentUser) {
    state.myUploadedPapers = [];
    state.myAnnotations = [];
    state.receivedReplies = [];
    return;
  }

  const dashboard = await apiRequest("/api/me/dashboard");
  state.myUploadedPapers = dashboard.uploadedPapers || [];
  state.myAnnotations = dashboard.myAnnotations || [];
  state.receivedReplies = dashboard.repliesToMyAnnotations || [];
}

async function refreshMembers() {
  if (!state.currentUser) {
    state.allUsers = [];
    state.groupMembers = [];
    state.selectedMemberId = null;
    state.selectedMemberProfile = null;
    return;
  }

  const users = await apiRequest("/api/users");
  state.allUsers = users;
  state.groupMembers = users.filter((user) => user.id !== state.currentUser.id);

  if (!state.groupMembers.length) {
    state.selectedMemberId = null;
    state.selectedMemberProfile = null;
    return;
  }

  if (!state.groupMembers.some((member) => member.id === state.selectedMemberId)) {
    state.selectedMemberId = state.groupMembers[0].id;
    state.selectedMemberProfile = null;
  }
}

async function refreshSelectedMemberProfile() {
  if (!state.currentUser || !state.selectedMemberId) {
    state.selectedMemberProfile = null;
    return;
  }

  state.selectedMemberProfile = await apiRequest(
    `/api/users/${encodeURIComponent(state.selectedMemberId)}/profile`
  );
}

async function refreshMembersData() {
  await refreshMembers();
  await refreshSelectedMemberProfile();
}

async function refreshSelectedPaperAnnotations() {
  if (!state.currentUser || !state.selectedPaperId) {
    state.annotations = [];
    state.selectedAnnotationId = null;
    state.selectedReplyId = null;
    return;
  }

  const annotations = await apiRequest(
    `/api/papers/${encodeURIComponent(state.selectedPaperId)}/annotations`
  );
  state.annotations = annotations.sort(compareAnnotationsForDisplay);

  if (!getTopLevelAnnotations().some((annotation) => annotation.id === state.selectedAnnotationId)) {
    state.selectedAnnotationId = null;
  }

  if (!state.annotations.some((annotation) => annotation.id === state.selectedReplyId)) {
    state.selectedReplyId = null;
  }
}

async function refreshSelectedPaperDiscussions() {
  if (!state.currentUser || !state.selectedPaperId) {
    state.discussions = [];
    state.selectedDiscussionId = null;
    state.selectedDiscussionReplyId = null;
    return;
  }

  const discussions = await apiRequest(
    `/api/papers/${encodeURIComponent(state.selectedPaperId)}/discussions`
  );
  state.discussions = discussions.sort(compareDiscussionsForDisplay);

  if (!getTopLevelDiscussions().some((discussion) => discussion.id === state.selectedDiscussionId)) {
    state.selectedDiscussionId = null;
  }

  if (!state.discussions.some((discussion) => discussion.id === state.selectedDiscussionReplyId)) {
    state.selectedDiscussionReplyId = null;
  }
}

async function openAnnotationLocation(paperId, annotationId, options = {}) {
  if (!state.currentUser) {
    return;
  }

  const { focusReplyId = "" } = options;

  if (!state.papers.some((paper) => paper.id === paperId)) {
    window.alert("这条批注对应的文献已不存在，暂时无法跳转。");
    return;
  }

  if (!IS_DETAIL_PAGE) {
    openPaperDetail({
      paperId,
      panel: "reader",
      annotationId,
      replyId: focusReplyId,
    });
    return;
  }

  state.currentView = "library";
  state.libraryPanel = "reader";

  if (state.selectedPaperId !== paperId) {
    await selectPaper(paperId, {
      focusAnnotationId: annotationId,
      focusReplyId,
    });
    render();
    return;
  }

  state.selectedAnnotationId = annotationId;
  state.selectedReplyId = focusReplyId || null;
  state.annotationNavigationTargetId = annotationId;
  render();
}

async function openDiscussionLocation(paperId, discussionId, options = {}) {
  if (!state.currentUser) {
    return;
  }

  const { focusReplyId = "" } = options;

  if (!state.papers.some((paper) => paper.id === paperId)) {
    window.alert("这条讨论对应的文献已不存在，暂时无法跳转。");
    return;
  }

  if (!IS_DETAIL_PAGE) {
    openPaperDetail({
      paperId,
      panel: "discussion",
      discussionId,
      discussionReplyId: focusReplyId,
    });
    return;
  }

  state.currentView = "library";
  state.libraryPanel = "discussion";
  closeReaderContextMenu();
  clearPendingSelection();
  syncPendingSelectionHighlight();

  if (state.selectedPaperId !== paperId) {
    await selectPaper(paperId, {
      focusDiscussionId: discussionId,
      focusDiscussionReplyId: focusReplyId,
    });
    render();
    return;
  }

  state.selectedDiscussionId = discussionId;
  state.selectedDiscussionReplyId = focusReplyId || null;
  state.discussionNavigationTargetId = discussionId;
  render();
}

async function openSpeechLocation(options = {}) {
  const {
    speechType = "annotation",
    paperId = "",
    threadId = "",
    replyId = "",
  } = options;

  if (!paperId || !threadId) {
    return;
  }

  if (speechType === "discussion") {
    await openDiscussionLocation(paperId, threadId, { focusReplyId: replyId });
    return;
  }

  await openAnnotationLocation(paperId, threadId, { focusReplyId: replyId });
}

function getOwnAnnotationsForSelectedPaper() {
  if (!state.currentUser || !state.selectedPaperId) {
    return [];
  }

  return state.annotations.filter(
    (annotation) => annotation.created_by_user_id === state.currentUser.id
  );
}

function getAnnotationById(annotationId) {
  return state.annotations.find((annotation) => annotation.id === annotationId) || null;
}

function getTopLevelAnnotations() {
  return state.annotations.filter((annotation) => !isReplyAnnotation(annotation));
}

function getSelectedThreadAnnotation() {
  return getTopLevelAnnotations().find((annotation) => annotation.id === state.selectedAnnotationId) || null;
}

function getReplyAnnotations() {
  return state.annotations.filter((annotation) => isReplyAnnotation(annotation));
}

function getRepliesForAnnotation(annotationId) {
  return getReplyAnnotations()
    .filter((annotation) => getThreadRootAnnotationId(annotation) === annotationId)
    .sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));
}

function getDiscussionById(discussionId) {
  return state.discussions.find((discussion) => discussion.id === discussionId) || null;
}

function getTopLevelDiscussions() {
  return state.discussions.filter((discussion) => !isDiscussionReply(discussion));
}

function getDiscussionReplies() {
  return state.discussions.filter((discussion) => isDiscussionReply(discussion));
}

function getRepliesForDiscussion(discussionId) {
  return getDiscussionReplies()
    .filter((discussion) => getThreadRootDiscussionId(discussion) === discussionId)
    .sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));
}

function getSelectedDiscussionThread() {
  return (
    getTopLevelDiscussions().find((discussion) => discussion.id === state.selectedDiscussionId) ||
    null
  );
}

function getSelectedDiscussionReply() {
  const selectedReply = getDiscussionById(state.selectedDiscussionReplyId);
  return selectedReply && isDiscussionReply(selectedReply) ? selectedReply : null;
}

function getActiveDiscussionReplyTarget() {
  return getSelectedDiscussionReply() || getSelectedDiscussionThread();
}

function getDiscussionAuthorName(discussion) {
  return discussion?.created_by_username || "未知用户";
}

function getDiscussionReplyRelationText(reply) {
  const target =
    getDiscussionById(reply.parent_discussion_id) ||
    getDiscussionById(getThreadRootDiscussionId(reply)) ||
    null;
  return `${getDiscussionAuthorName(reply)}回复${getDiscussionAuthorName(target)}：`;
}

function getReplyTargetAnnotation(annotation) {
  if (!annotation) {
    return null;
  }

  if (!isReplyAnnotation(annotation)) {
    return annotation;
  }

  return (
    getAnnotationById(annotation.parent_annotation_id) ||
    getAnnotationById(getThreadRootAnnotationId(annotation)) ||
    null
  );
}

function getSelectedReplyAnnotation() {
  const selectedReply = getAnnotationById(state.selectedReplyId);
  return selectedReply && isReplyAnnotation(selectedReply) ? selectedReply : null;
}

function getActiveReplyTargetAnnotation() {
  return getSelectedReplyAnnotation() || getSelectedThreadAnnotation();
}

function getAnnotationAuthorName(annotation) {
  return annotation?.created_by_username || "未知用户";
}

function getReplyRelationText(reply) {
  return `${getAnnotationAuthorName(reply)}回复${getAnnotationAuthorName(
    getReplyTargetAnnotation(reply)
  )}：`;
}

function canDeletePaper(paper) {
  return canDeleteOwnedRecord(paper, state.currentUser);
}

function shouldOfferBrowserFetchFallback(message) {
  return /(403|人机验证|访问限制|访问拦截|验证码|verify|human verification)/i.test(
    String(message || "")
  );
}

function canDeleteAnnotation(annotation) {
  return canDeleteOwnedRecord(annotation, state.currentUser);
}

function canEditAnnotation(annotation) {
  return canDeleteAnnotation(annotation);
}

function canDeleteDiscussion(discussion) {
  return canDeleteAnnotation(discussion);
}

function canEditDiscussion(discussion) {
  return canDeleteDiscussion(discussion);
}

function isCurrentUserAdmin() {
  return isAdminUser(state.currentUser);
}

function formatUserBadge(user) {
  if (!user) {
    return "";
  }

  return getUserRole(user) === "admin" ? `${user.username}（管理员）` : user.username;
}

function createEmptyEditState() {
  return {
    targetId: null,
    targetType: "",
    draft: "",
    attachments: [],
    isSaving: false,
  };
}

function resetAnnotationEditState() {
  state.annotationEditState = createEmptyEditState();
}

function resetDiscussionEditState() {
  state.discussionEditState = createEmptyEditState();
}

function getDetailEditTarget(kind) {
  const records = kind === "discussion" ? state.discussions : state.annotations;
  const editState = getDetailEditState(kind);
  return records.find((item) => item.id === editState.targetId) || null;
}

function getAnnotationEditTarget() {
  return getDetailEditTarget("annotation");
}

function getDiscussionEditTarget() {
  return getDetailEditTarget("discussion");
}

function getEditableAttachmentItems(editState) {
  return Array.isArray(editState?.attachments) ? editState.attachments.filter(Boolean) : [];
}

function createEditableAttachmentItems(attachments) {
  return getAttachmentList(attachments).map((attachment) => ({
    kind: "existing",
    key: getExistingEditableAttachmentKey(attachment),
    attachment,
  }));
}

function getExistingEditableAttachmentKey(attachment) {
  return `existing:${attachment?.id || attachment?.storage_path || attachment?.url || ""}`;
}

function getNewEditableAttachmentKey(file) {
  return `new:${getAttachmentFileSignature(file)}`;
}

function focusSpeechDetailEditor(kind) {
  window.requestAnimationFrame(() => {
    const editor = document.querySelector(
      kind === "discussion" ? "#discussion-detail-editor" : "#annotation-detail-editor"
    );
    editor?.focus();
    editor?.setSelectionRange?.(editor.value.length, editor.value.length);
  });
}

function focusAnnotationDetailEditor() {
  focusSpeechDetailEditor("annotation");
}

function focusDiscussionDetailEditor() {
  focusSpeechDetailEditor("discussion");
}

function readSpeechDetailEditorValue(kind) {
  const editor = document.querySelector(
    kind === "discussion" ? "#discussion-detail-editor" : "#annotation-detail-editor"
  );
  return String(editor?.value || "").trim();
}

function readAnnotationDetailEditorValue() {
  return readSpeechDetailEditorValue("annotation");
}

function readDiscussionDetailEditorValue() {
  return readSpeechDetailEditorValue("discussion");
}

function getSpeechEditMutationOptions(kind) {
  if (kind === "discussion") {
    return {
      compareRecords: compareDiscussionsForDisplay,
      editActionLabel: "讨论",
      endpoint: "/api/discussions",
      focusEditor: focusDiscussionDetailEditor,
      renderDetail: renderDiscussionDetail,
      replyIdKey: "selectedDiscussionReplyId",
      stateKey: "discussions",
    };
  }

  return {
    compareRecords: compareAnnotationsForDisplay,
    editActionLabel: "批注",
    endpoint: "/api/annotations",
    focusEditor: focusAnnotationDetailEditor,
    renderDetail: renderAnnotationDetail,
    replyIdKey: "selectedReplyId",
    stateKey: "annotations",
  };
}

async function saveSpeechDetailEdit(kind) {
  const record = getDetailEditTarget(kind);
  const editState = getDetailEditState(kind);
  const mutationOptions = getSpeechEditMutationOptions(kind);

  if (!record || editState.isSaving) {
    return;
  }

  const nextNote = readSpeechDetailEditorValue(kind);
  const nextAttachments = getEditableAttachmentItems(editState);
  editState.draft = nextNote;

  try {
    validateEditableAttachmentItems(nextAttachments);
  } catch (error) {
    window.alert(error.message || "附件不符合上传要求。");
    return;
  }

  if (!nextNote && nextAttachments.length === 0) {
    window.alert(`请至少保留${mutationOptions.editActionLabel}内容或一个附件。`);
    mutationOptions.focusEditor();
    return;
  }

  if (nextNote === record.note && areEditableAttachmentsUnchanged(nextAttachments, record)) {
    if (kind === "discussion") {
      resetDiscussionEditState();
    } else {
      resetAnnotationEditState();
    }
    mutationOptions.renderDetail();
    return;
  }

  editState.isSaving = true;
  mutationOptions.renderDetail();

  try {
    const attachments = splitEditableAttachmentItems(nextAttachments);
    const formData = createSpeechFormData({
      note: nextNote,
      attachments: attachments.newFiles,
      retainedAttachments: attachments.existingAttachments,
    });
    const updated = await apiRequest(`${mutationOptions.endpoint}/${encodeURIComponent(record.id)}`, {
      method: "PATCH",
      body: formData,
    });

    state[mutationOptions.stateKey] = state[mutationOptions.stateKey]
      .map((item) => (item.id === updated.id ? updated : item))
      .sort(mutationOptions.compareRecords);
    if (editState.targetType === "reply") {
      state[mutationOptions.replyIdKey] = updated.id;
    }
    if (kind === "discussion") {
      resetDiscussionEditState();
    } else {
      resetAnnotationEditState();
    }
    await refreshMyDashboard();
    await refreshMembersData();
    render();
  } catch (error) {
    console.error(`Failed to edit ${kind} detail item.`, error);
    editState.isSaving = false;
    mutationOptions.renderDetail();
    mutationOptions.focusEditor();
    window.alert(
      error.message ||
        (editState.targetType === "reply"
          ? "编辑回复失败，请稍后再试。"
          : `编辑${mutationOptions.editActionLabel}失败，请稍后再试。`)
    );
  }
}

async function saveAnnotationDetailEdit() {
  await saveSpeechDetailEdit("annotation");
}

async function saveDiscussionDetailEdit() {
  await saveSpeechDetailEdit("discussion");
}

function getNextPaperIdAfterDeletion(deletedPaperId) {
  return state.papers.find((paper) => paper.id !== deletedPaperId)?.id || null;
}

function matchesPaperSearchTerm(paper, searchTerm) {
  const searchableValues = [
    paper.title,
    paper.authors,
    paper.journal,
    paper.abstract,
    ...(Array.isArray(paper.keywords) ? paper.keywords : []),
    paper.created_by_username,
  ];

  return searchableValues.some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(searchTerm)
  );
}

function getVisiblePapers() {
  if (!state.searchTerm) {
    return state.papers;
  }

  return state.papers.filter((paper) => matchesPaperSearchTerm(paper, state.searchTerm));
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

function extractReadableArticleHtml(rawHtml, baseUrl, options = {}) {
  const parser = new DOMParser();
  const documentSnapshot = parser.parseFromString(rawHtml, "text/html");
  const resolvedBaseUrl = resolveArticleBaseUrl(documentSnapshot, baseUrl);
  const preloadedState = parsePreloadedStateFromHtml(rawHtml);
  const allowImages = options.allowImages !== false;

  if (isScienceDirectSnapshot(documentSnapshot, preloadedState)) {
    const scienceDirectHtml = extractScienceDirectArticleHtml(
      documentSnapshot,
      resolvedBaseUrl,
      preloadedState,
      { allowImages }
    );

    if (scienceDirectHtml) {
      return scienceDirectHtml;
    }
  }

  const article =
    documentSnapshot.querySelector("main.c-article-main-column article") ||
    documentSnapshot.querySelector("article") ||
    documentSnapshot.querySelector("main") ||
    documentSnapshot.body;

  if (!article) {
    return "";
  }

  const articleBody = article.querySelector(".c-article-body") || article;
  const bodyClone = articleBody.cloneNode(true);
  sanitizeArticleBody(bodyClone);
  absolutizeNodeUrls(bodyClone, resolvedBaseUrl);
  enforceArticleImagePolicy(bodyClone, { allowImages });
  return bodyClone.innerHTML;
}

function isScienceDirectSnapshot(documentSnapshot, preloadedState) {
  const canonicalUrl =
    documentSnapshot.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
  const hostname = safeParseHostname(canonicalUrl);

  return (
    hostname.includes("sciencedirect.com") ||
    Boolean(preloadedState?.article?.eid) ||
    Boolean(preloadedState?.article?.ajaxLinks?.body)
  );
}

function isArticleImagesEnabledForPaper(paper) {
  if (!paper) {
    return false;
  }

  if (typeof paper.articleImagesEnabled === "boolean") {
    return paper.articleImagesEnabled;
  }

  return supportsArticleImagesForSourceUrl(paper.sourceUrl);
}

function extractScienceDirectArticleHtml(documentSnapshot, baseUrl, preloadedState, options = {}) {
  const container = documentSnapshot.createElement("div");
  const textContent = documentSnapshot.querySelector(".text-content");
  const textClone = textContent ? textContent.cloneNode(true) : null;

  if (textClone) {
    sanitizeArticleBody(textClone);
    absolutizeNodeUrls(textClone, baseUrl);
    enforceArticleImagePolicy(textClone, options);
  }

  const extractedText = textClone?.textContent?.replace(/\s+/g, " ").trim() || "";
  const bodyUnavailable =
    hasScienceDirectDeferredBody(preloadedState) &&
    (!extractedText || hasOnlyAuxiliaryScienceDirectSections(textClone));

  if (bodyUnavailable) {
    container.appendChild(createScienceDirectBodyNotice(documentSnapshot));
  }

  if (textClone && extractedText) {
    while (textClone.firstChild) {
      container.appendChild(textClone.firstChild);
    }
  }

  return container.innerHTML.trim();
}

function hasScienceDirectDeferredBody(preloadedState) {
  if (!preloadedState) {
    return false;
  }

  const bodyKeys = Object.keys(preloadedState.body || {});
  const previewKeys = Object.keys(preloadedState.preview || {});
  const rawText = String(preloadedState.rawtext || "").trim();

  return (
    Boolean(preloadedState?.article?.ajaxLinks?.body) &&
    bodyKeys.length === 0 &&
    previewKeys.length === 0 &&
    !rawText
  );
}

function hasOnlyAuxiliaryScienceDirectSections(root) {
  if (!root) {
    return true;
  }

  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4"))
    .map((heading) => heading.textContent.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);

  if (!headings.length) {
    return true;
  }

  return headings.every((heading) =>
    [
      "data availability",
      "code availability",
      "acknowledgements",
      "acknowledgments",
      "funding",
      "declaration of competing interest",
      "declaration of generative ai and ai-assisted technologies in the writing process",
      "references",
      "appendix",
      "supplementary data",
      "supplementary materials",
    ].includes(heading)
  );
}

function createScienceDirectBodyNotice(documentSnapshot) {
  const notice = documentSnapshot.createElement("section");
  notice.className = "empty-state";
  notice.innerHTML = [
    "<p>当前保存的 ScienceDirect 页面源码没有包含正文全文，只带了作者、摘要和少量附加信息。</p>",
    "<p>这通常是因为正文是在页面加载后再单独请求的，所以这份源码本身不足以还原完整正文。</p>",
  ].join("");
  return notice;
}

function resolveArticleBaseUrl(documentSnapshot, baseUrl) {
  const baseHref = documentSnapshot.querySelector("base[href]")?.getAttribute("href");

  if (baseHref) {
    try {
      return new URL(baseHref, baseUrl).toString();
    } catch (error) {
      return baseUrl;
    }
  }

  const canonicalUrl = documentSnapshot
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");

  if (canonicalUrl) {
    try {
      return new URL(canonicalUrl, baseUrl).toString();
    } catch (error) {
      return baseUrl;
    }
  }

  const ogUrl = documentSnapshot
    .querySelector('meta[property="og:url"]')
    ?.getAttribute("content");

  if (ogUrl) {
    try {
      return new URL(ogUrl, baseUrl).toString();
    } catch (error) {
      return baseUrl;
    }
  }

  return baseUrl;
}

function applyAnnotationHighlight(annotation) {
  const scopeRoot = getAnnotationScopeRoot(annotation.target_scope);

  if (!scopeRoot) {
    console.warn("Failed to resolve annotation scope root.", annotation);
    return;
  }

  const resolvedOffsets = resolveAnnotationOffsets(annotation);

  if (!resolvedOffsets) {
    console.warn("Failed to restore annotation highlight.", annotation);
    return;
  }

  applyOffsetsHighlight(scopeRoot, resolvedOffsets.start, resolvedOffsets.end, (mark) => {
    mark.className = "annotation-highlight";
    mark.dataset.annotationId = annotation.id;
    mark.title = "点击查看批注";
  });
}

function syncPendingSelectionHighlight() {
  clearPendingSelectionHighlight();

  if (!state.pendingSelection) {
    return;
  }

  const scopeRoot = getAnnotationScopeRoot(state.pendingSelection.target_scope);

  if (!scopeRoot) {
    return;
  }

  applyOffsetsHighlight(
    scopeRoot,
    state.pendingSelection.start_offset,
    state.pendingSelection.end_offset,
    (mark) => {
      mark.className = "pending-selection-highlight";
      mark.title = "待保存选区";
    }
  );
}

function clearPendingSelectionHighlight() {
  if (!annotationRoot) {
    return;
  }

  annotationRoot.querySelectorAll(".pending-selection-highlight").forEach((highlight) => {
    const parent = highlight.parentNode;

    if (!parent) {
      return;
    }

    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight);
    }

    parent.removeChild(highlight);
    parent.normalize();
  });
}

function applyOffsetsHighlight(root, startOffset, endOffset, decorateMark) {
  const segments = resolveSegmentsFromOffsets(root, startOffset, endOffset);

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const range = document.createRange();
    range.setStart(segment.node, segment.start);
    range.setEnd(segment.node, segment.end);

    const mark = document.createElement("mark");
    decorateMark(mark);
    range.surroundContents(mark);
  }
}

function resolveSegmentsFromOffsets(root, startOffset, endOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments = [];
  let currentNode = walker.nextNode();
  let cursor = 0;

  while (currentNode) {
    const nodeLength = currentNode.textContent.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + nodeLength;
    const overlapStart = Math.max(nodeStart, startOffset);
    const overlapEnd = Math.min(nodeEnd, endOffset);

    if (overlapStart < overlapEnd) {
      segments.push({
        node: currentNode,
        start: overlapStart - nodeStart,
        end: overlapEnd - nodeStart,
      });
    }

    cursor = nodeEnd;
    currentNode = walker.nextNode();
  }

  return segments;
}

function getRangeTextOffsets(root, range) {
  const startRange = document.createRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = document.createRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    startOffset: startRange.toString().length,
    endOffset: endRange.toString().length,
  };
}

function readPendingSelectionFromWindowSelection() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const scopeRoot = getAnnotationScopeRootFromNode(range.commonAncestorContainer);

  if (!scopeRoot) {
    return null;
  }

  const scope = getAnnotationScopeFromRoot(scopeRoot);

  if (!isAnnotationScopeAvailable(scope)) {
    return null;
  }

  let offsets;

  try {
    offsets = getRangeTextOffsets(scopeRoot, range);
  } catch (error) {
    console.error("Failed to capture selection offsets.", error);
    return null;
  }

  const { startOffset, endOffset } = offsets;

  if (startOffset === endOffset) {
    return null;
  }

  const normalizedStart = Math.min(startOffset, endOffset);
  const normalizedEnd = Math.max(startOffset, endOffset);
  const fullText = getScopeText(scopeRoot);
  const exact = fullText.slice(normalizedStart, normalizedEnd);

  if (!exact.trim()) {
    return null;
  }

  return {
    target_scope: scope,
    exact,
    prefix: fullText.slice(Math.max(0, normalizedStart - CONTEXT_RADIUS), normalizedStart),
    suffix: fullText.slice(
      normalizedEnd,
      Math.min(fullText.length, normalizedEnd + CONTEXT_RADIUS)
    ),
    start_offset: normalizedStart,
    end_offset: normalizedEnd,
  };
}

function getTextLength(node) {
  if (!node) {
    return 0;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent.length;
  }

  let length = 0;

  for (const child of node.childNodes) {
    length += getTextLength(child);
  }

  return length;
}

function syncActiveHighlight() {
  document.querySelectorAll(".annotation-highlight").forEach((highlight) => {
    highlight.classList.toggle(
      "active",
      highlight.dataset.annotationId === state.selectedAnnotationId
    );
  });
}

function flushPendingAnnotationNavigation() {
  if (!annotationRoot || !annotationList || !annotationDetail) {
    return;
  }

  if (
    (!state.annotationNavigationTargetId && !state.selectedReplyId) ||
    state.currentView !== "library" ||
    state.libraryPanel !== "reader"
  ) {
    return;
  }

  const annotationId = state.annotationNavigationTargetId;
  const highlight = annotationId
    ? annotationRoot.querySelector(`[data-annotation-id="${annotationId}"]`)
    : null;
  const listItem = annotationId
    ? annotationList.querySelector(`[data-annotation-id="${annotationId}"]`)
    : null;
  const detailScrollTarget = annotationDetailPanel || annotationDetail;
  const shouldScrollToDetail =
    Boolean(annotationId) && detailScrollTarget && !annotationDetail.classList.contains("empty-state");
  const replyItem = state.selectedReplyId
    ? annotationDetail.querySelector(`[data-reply-id="${state.selectedReplyId}"]`)
    : null;

  if (highlight) {
    highlight.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
  }

  if (listItem) {
    listItem.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }

  if (replyItem) {
    replyItem.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }

  if (shouldScrollToDetail) {
    detailScrollTarget.scrollIntoView({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
  }

  if (highlight || listItem || replyItem || shouldScrollToDetail) {
    state.annotationNavigationTargetId = null;
  }
}

function flushPendingDiscussionNavigation() {
  if (
    (!state.discussionNavigationTargetId && !state.selectedDiscussionReplyId) ||
    state.currentView !== "library" ||
    state.libraryPanel !== "discussion"
  ) {
    return;
  }

  const discussionId = state.discussionNavigationTargetId;
  const listItem = discussionId
    ? discussionList?.querySelector(`[data-discussion-id="${discussionId}"]`)
    : null;
  const detailScrollTarget = discussionDetailPanel || discussionDetail;
  const shouldScrollToDetail =
    Boolean(discussionId) &&
    detailScrollTarget &&
    discussionDetail &&
    !discussionDetail.classList.contains("empty-state");
  const replyItem = state.selectedDiscussionReplyId
    ? discussionDetail?.querySelector(
        `[data-discussion-reply-id="${state.selectedDiscussionReplyId}"]`
      )
    : null;

  if (listItem) {
    listItem.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }

  if (replyItem) {
    replyItem.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }

  if (shouldScrollToDetail) {
    detailScrollTarget.scrollIntoView({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
  }

  if (listItem || replyItem || shouldScrollToDetail) {
    state.discussionNavigationTargetId = null;
  }
}

function getScopeText(root) {
  return root?.textContent || "";
}

function resolveAnnotationOffsets(annotation) {
  const scopeRoot = getAnnotationScopeRoot(annotation.target_scope);

  if (!scopeRoot) {
    return null;
  }

  const fullText = getScopeText(scopeRoot);
  const offsetMatch = fullText.slice(annotation.start_offset, annotation.end_offset);

  if (offsetMatch === annotation.exact) {
    return {
      start: annotation.start_offset,
      end: annotation.end_offset,
    };
  }

  const fallbackStart = fullText.indexOf(annotation.exact);

  if (fallbackStart === -1) {
    return null;
  }

  const candidates = [];
  let searchFrom = 0;

  while (searchFrom !== -1) {
    const candidateStart = fullText.indexOf(annotation.exact, searchFrom);

    if (candidateStart === -1) {
      break;
    }

    const candidateEnd = candidateStart + annotation.exact.length;
    const prefix = fullText.slice(
      Math.max(0, candidateStart - annotation.prefix.length),
      candidateStart
    );
    const suffix = fullText.slice(candidateEnd, candidateEnd + annotation.suffix.length);
    const prefixMatches = !annotation.prefix || prefix === annotation.prefix;
    const suffixMatches = !annotation.suffix || suffix === annotation.suffix;

    if (prefixMatches && suffixMatches) {
      candidates.push({
        start: candidateStart,
        end: candidateEnd,
      });
    }

    searchFrom = candidateStart + 1;
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  return {
    start: fallbackStart,
    end: fallbackStart + annotation.exact.length,
  };
}

function normalizeAnnotationScope(scope) {
  const normalizedScope = String(scope || DEFAULT_ANNOTATION_SCOPE).trim().toLowerCase();
  return ANNOTATION_SCOPE_LABELS[normalizedScope] ? normalizedScope : DEFAULT_ANNOTATION_SCOPE;
}

function getAnnotationScopeLabel(scope) {
  return ANNOTATION_SCOPE_LABELS[normalizeAnnotationScope(scope)];
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

function compareAnnotationsForDisplay(left, right) {
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

  return left.start_offset - right.start_offset;
}

function compareDiscussionsForDisplay(left, right) {
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

    return new Date(left.created_at || 0) - new Date(right.created_at || 0);
  }

  return new Date(left.created_at || 0) - new Date(right.created_at || 0);
}

function handleAttachmentInputChange(event) {
  const input = event?.currentTarget;
  const nextFiles = Array.from(input?.files || []);

  if (!input) {
    return;
  }

  if (!nextFiles.length) {
    input.value = "";
    return;
  }

  const mergedFiles = mergeAttachmentFiles(getAttachmentFiles(input), nextFiles);

  try {
    validateAttachmentFiles(mergedFiles);
  } catch (error) {
    input.value = "";
    rerenderAttachmentDependentComposers();
    window.alert(error.message || "附件不符合上传要求。");
    return;
  }

  composerAttachmentFiles.set(input, mergedFiles);
  input.value = "";
  rerenderAttachmentDependentComposers();
}

function getDetailEditState(kind) {
  return kind === "discussion" ? state.discussionEditState : state.annotationEditState;
}

function renderDetailEditState(kind) {
  if (kind === "discussion") {
    renderDiscussionDetail();
    focusDiscussionDetailEditor();
    return;
  }

  renderAnnotationDetail();
  focusAnnotationDetailEditor();
}

function handleDetailEditAttachmentInputChange(kind, input) {
  const editState = getDetailEditState(kind);

  if (!editState?.targetId) {
    input.value = "";
    return;
  }

  const nextFiles = Array.from(input?.files || []);

  if (!nextFiles.length) {
    input.value = "";
    return;
  }

  const existingItems = getEditableAttachmentItems(editState).filter((item) => item.kind === "existing");
  const currentNewFiles = getEditableAttachmentItems(editState)
    .filter((item) => item.kind === "new")
    .map((item) => item.file)
    .filter(Boolean);
  const mergedNewFiles = mergeAttachmentFiles(currentNewFiles, nextFiles);
  const nextItems = [
    ...existingItems,
    ...mergedNewFiles.map((file) => ({
      kind: "new",
      key: getNewEditableAttachmentKey(file),
      file,
    })),
  ];

  try {
    validateEditableAttachmentItems(nextItems);
  } catch (error) {
    input.value = "";
    renderDetailEditState(kind);
    window.alert(error.message || "附件不符合上传要求。");
    return;
  }

  editState.attachments = nextItems;
  input.value = "";
  renderDetailEditState(kind);
}

function clearComposerAttachments(input) {
  if (!input) {
    return;
  }

  composerAttachmentFiles.delete(input);
  input.value = "";
  rerenderAttachmentDependentComposers();
}

function getAttachmentFiles(input) {
  return Array.from(composerAttachmentFiles.get(input) || []);
}

function clearDetailEditAttachments(kind) {
  const editState = getDetailEditState(kind);

  if (!editState?.targetId || editState.isSaving) {
    return;
  }

  editState.attachments = [];
  renderDetailEditState(kind);
}

function removeDetailEditAttachmentByKey(kind, key) {
  const editState = getDetailEditState(kind);

  if (!editState?.targetId || editState.isSaving) {
    return;
  }

  editState.attachments = getEditableAttachmentItems(editState).filter((item) => item.key !== key);
  renderDetailEditState(kind);
}

function handleAttachmentPreviewClick(event) {
  const removeButton = event.target.closest("[data-remove-attachment-index]");
  const preview = event?.currentTarget;

  if (!removeButton || !preview) {
    return;
  }

  const config = getAttachmentComposerConfigByPreview(preview);

  if (!config?.input) {
    return;
  }

  removeComposerAttachmentByIndex(config.input, Number(removeButton.dataset.removeAttachmentIndex));
}

async function readAttachmentPayloads(input) {
  const files = getAttachmentFiles(input);
  validateAttachmentFiles(files);
  return files;
}

function splitEditableAttachmentItems(items) {
  validateEditableAttachmentItems(items);

  return {
    existingAttachments: items
      .filter((item) => item?.kind === "existing")
      .map((item) => ({ ...item.attachment })),
    newFiles: items
      .filter((item) => item?.kind === "new")
      .map((item) => item.file)
      .filter(Boolean),
  };
}

function createSpeechFormData({ note = "", attachments = [], selection = null, retainedAttachments = [] }) {
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

  attachments.forEach((file) => {
    if (file instanceof File) {
      formData.append("attachments", file, file.name);
    }
  });

  return formData;
}

function getAttachmentComposerConfigByPreview(preview) {
  return attachmentComposerConfigs.find((config) => config.preview === preview) || null;
}

function mergeAttachmentFiles(existingFiles, nextFiles) {
  const mergedFiles = [...existingFiles];
  const seen = new Set(existingFiles.map(getAttachmentFileSignature));

  for (const file of nextFiles) {
    const signature = getAttachmentFileSignature(file);

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    mergedFiles.push(file);
  }

  return mergedFiles;
}

function getAttachmentFileSignature(file) {
  return [
    file?.name || "",
    file?.size || 0,
    file?.type || "",
    file?.lastModified || 0,
  ].join("::");
}

function removeComposerAttachmentByIndex(input, index) {
  if (!input || !Number.isInteger(index) || index < 0) {
    return;
  }

  const files = getAttachmentFiles(input);

  if (!files[index]) {
    return;
  }

  files.splice(index, 1);

  if (files.length) {
    composerAttachmentFiles.set(input, files);
  } else {
    composerAttachmentFiles.delete(input);
  }

  rerenderAttachmentDependentComposers();
}

function validateEditableAttachmentItems(items) {
  const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];

  if (!normalizedItems.length) {
    return;
  }

  if (normalizedItems.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`单次最多上传 ${MAX_ATTACHMENT_COUNT} 个附件。`);
  }

  let totalBytes = 0;

  for (const item of normalizedItems) {
    if (item.kind === "existing") {
      totalBytes += item.attachment?.size_bytes || 0;
      continue;
    }

    const file = item.file;

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

function validateAttachmentFiles(files) {
  if (!files.length) {
    return;
  }

  if (files.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`单次最多上传 ${MAX_ATTACHMENT_COUNT} 个附件。`);
  }

  const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(`附件总大小不能超过 ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)}。`);
  }

  for (const file of files) {
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
  }
}

function areEditableAttachmentsUnchanged(items, record) {
  const currentAttachments = getAttachmentList(record?.attachments);
  const editableItems = Array.isArray(items) ? items.filter(Boolean) : [];

  if (editableItems.length !== currentAttachments.length) {
    return false;
  }

  return editableItems.every((item, index) => {
    if (item.kind !== "existing") {
      return false;
    }

    return (
      String(item.attachment?.storage_path || "") ===
      String(currentAttachments[index]?.storage_path || "")
    );
  });
}

async function encodeFileToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  return arrayBufferToBase64(arrayBuffer);
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

function getAttachmentCategory(fileOrAttachment) {
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

function normalizeAttachmentMimeType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function getAttachmentExtension(filename) {
  const normalizedName = String(filename || "").trim();
  const extensionIndex = normalizedName.lastIndexOf(".");
  return extensionIndex >= 0 ? normalizedName.slice(extensionIndex).toLowerCase() : "";
}

function getAttachmentCategoryLabel(fileOrAttachment) {
  const category = getAttachmentCategory(fileOrAttachment);
  return category === "image" ? "图片附件" : category === "table" ? "表格附件" : "附件";
}

function getAttachmentList(attachments) {
  return Array.isArray(attachments) ? attachments.filter(Boolean) : [];
}

function renderAttachmentSummaryTag(record) {
  const attachments = getAttachmentList(record?.attachments);

  if (!attachments.length) {
    return "";
  }

  return `<span class="attachment-summary-tag">附件 ${attachments.length} 个</span>`;
}

function renderAttachmentList(attachments) {
  const normalizedAttachments = getAttachmentList(attachments);

  if (!normalizedAttachments.length) {
    return "";
  }

  return `
    <div class="record-attachment-list">
      ${normalizedAttachments.map((attachment) => renderAttachmentCard(attachment)).join("")}
    </div>
  `;
}

function renderAttachmentCard(attachment) {
  const attachmentUrl = escapeHtml(buildAttachmentUrl(attachment));
  const attachmentName = escapeHtml(
    attachment?.original_name || attachment?.filename || "未命名附件"
  );
  const attachmentMeta = `${getAttachmentCategoryLabel(attachment)} · ${formatFileSize(
    attachment?.size_bytes || attachment?.size || 0
  )}`;

  if (getAttachmentCategory(attachment) === "image") {
    return `
      <a
        class="record-attachment-card is-image"
        href="${attachmentUrl}"
        target="_blank"
        rel="noreferrer"
      >
        <img src="${attachmentUrl}" alt="${attachmentName}" loading="lazy" />
        <span>${attachmentName}</span>
        <span>${escapeHtml(attachmentMeta)}</span>
      </a>
    `;
  }

  return `
    <a
      class="record-attachment-card"
      href="${attachmentUrl}"
      target="_blank"
      rel="noreferrer"
      download
    >
      <strong>${attachmentName}</strong>
      <span>${escapeHtml(attachmentMeta)}</span>
    </a>
  `;
}

function buildAttachmentUrl(attachment) {
  const rawUrl = String(attachment?.url || attachment?.storage_path || "").trim();

  if (!rawUrl) {
    return "#";
  }

  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const normalizedPath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
  return buildApiUrl(normalizedPath);
}

function getRecordNoteDisplay(record) {
  return String(record?.note || "").trim() || "（仅附件）";
}

function formatRecordNoteHtml(record) {
  return formatMultilineHtml(getRecordNoteDisplay(record));
}

function formatFileSize(sizeBytes) {
  const size = Number(sizeBytes) || 0;

  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${size} B`;
}

function rerenderAttachmentDependentComposers() {
  renderSelectionPanel();
  renderReplyComposer();
  renderDiscussionComposer();
  renderDiscussionReplyComposer();
  renderComposerAttachments();
}

function getAnnotationScopeRoot(scope) {
  if (!annotationRoot) {
    return null;
  }

  return annotationRoot.querySelector(
    `[data-annotation-scope="${normalizeAnnotationScope(scope)}"]`
  );
}

function getAnnotationScopeRootFromNode(node) {
  if (!node) {
    return null;
  }

  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element?.closest?.("[data-annotation-scope]") || null;
}

function getAnnotationScopeFromRoot(root) {
  return normalizeAnnotationScope(root?.dataset?.annotationScope);
}

function hasAvailableAnnotatableContent() {
  if (!state.selectedPaper) {
    return false;
  }

  return ["title", "authors", "abstract", "body"].some((scope) => isAnnotationScopeAvailable(scope));
}

function isAnnotationScopeAvailable(scope) {
  const normalizedScope = normalizeAnnotationScope(scope);

  if (normalizedScope === "body") {
    return Boolean(state.articleLoaded && state.articleHtml && getScopeText(articleRoot).trim());
  }

  return Boolean(getScopeText(getAnnotationScopeRoot(normalizedScope)).trim());
}

function sanitizeArticleBody(root) {
  root
    .querySelectorAll(
      [
        "script",
        "style",
        "noscript",
        "iframe",
        "button",
        "form",
        "footer",
        "nav",
        ".advertisement",
        ".c-article-recommendations",
        ".js-context-bar-sticky-point-mobile",
        ".u-hide",
        ".u-visually-hidden",
      ].join(", ")
    )
    .forEach((element) => element.remove());

  root.querySelectorAll("header").forEach((element) => {
    if (isFigureOrTableHeader(element)) {
      return;
    }

    element.remove();
  });

  root.querySelectorAll("[hidden]").forEach((element) => element.remove());
  removeAbstractSection(root);
}

function renderArticleMath(root) {
  if (!root || !window.temml?.renderMathInElement) {
    return;
  }

  normalizeLegacyArticleMath(root);

  try {
    window.temml.renderMathInElement(root, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\begin{equation}", right: "\\end{equation}", display: true },
        { left: "\\begin{equation*}", right: "\\end{equation*}", display: true },
        { left: "\\begin{align}", right: "\\end{align}", display: true },
        { left: "\\begin{align*}", right: "\\end{align*}", display: true },
        { left: "\\begin{gather}", right: "\\end{gather}", display: true },
        { left: "\\begin{gather*}", right: "\\end{gather*}", display: true },
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
      ignoredClasses: ["annotation-highlight", "pending-selection-highlight"],
      throwOnError: false,
      errorCallback(message, error) {
        console.warn(message, error);
      },
    });
  } catch (error) {
    console.error("Failed to render article math.", error);
  }
}

function normalizeLegacyArticleMath(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];

  while (walker.nextNode()) {
    const textNode = walker.currentNode;

    if (
      !textNode.nodeValue ||
      (!textNode.nodeValue.includes("\\mathop \\sum \\limits") &&
        !textNode.nodeValue.includes("\\mathop \\sum \\nolimits"))
    ) {
      continue;
    }

    textNodes.push(textNode);
  }

  textNodes.forEach((textNode) => {
    textNode.nodeValue = textNode.nodeValue
      .replaceAll("\\mathop \\sum \\limits", "\\sum \\limits")
      .replaceAll("\\mathop \\sum \\nolimits", "\\sum \\nolimits");
  });
}

function filterArticleFigures(root) {
  const figureSelectors = [
    "figure",
    ".figure",
    ".figure-wrap",
    ".figure__container",
    ".c-article-figure",
    ".o-figure",
    ".article-figure",
    "[data-figure]",
  ];
  const figureSelector = figureSelectors.join(", ");

  const isInsideFigure = (node) => Boolean(node.closest?.(figureSelector));

  const isLikelyNonFigureImage = (img) => {
    const src = String(img.getAttribute("src") || "").toLowerCase();
    const alt = String(img.getAttribute("alt") || "").toLowerCase();
    const className = String(img.getAttribute("class") || "").toLowerCase();
    const parentLink = img.closest("a");
    const href = String(parentLink?.getAttribute("href") || "").toLowerCase();

    if (isTransparentPlaceholder(src)) {
      return true;
    }

    if (href.includes(".pdf") || src.includes(".pdf")) {
      return true;
    }

    return /logo|cover|icon|spinner|loading|placeholder/.test(
      [src, alt, className].join(" ")
    );
  };

  root.querySelectorAll("img").forEach((img) => {
    if (!isInsideFigure(img) || isLikelyNonFigureImage(img)) {
      img.remove();
    }
  });

  root.querySelectorAll("picture, source").forEach((node) => {
    if (!isInsideFigure(node)) {
      node.remove();
    }
  });

  root.querySelectorAll(figureSelector).forEach((figure) => {
    const hasMedia = figure.querySelector("img, picture, svg, canvas");
    if (!hasMedia) {
      figure.remove();
    }
  });
}

function enforceArticleImagePolicy(root, options = {}) {
  if (!root) {
    return;
  }

  if (options.allowImages === false) {
    removeArticleFigureMedia(root);
    return;
  }

  filterArticleFigures(root);
}

function removeArticleFigureMedia(root) {
  const figureSelectors = [
    "figure",
    ".figure",
    ".figure-wrap",
    ".figure__container",
    ".c-article-figure",
    ".o-figure",
    ".article-figure",
    "[data-figure]",
  ];
  const figureSelector = figureSelectors.join(", ");

  root.querySelectorAll(figureSelector).forEach((figure) => {
    figure.remove();
  });

  root.querySelectorAll("img, picture, source, svg, canvas, video, audio, object, embed, image").forEach((element) => {
    element.remove();
  });

  [
    "src",
    "srcset",
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-zoom-src",
    "data-hires",
    "data-srcset",
    "poster",
  ].forEach((attribute) => {
    root.querySelectorAll(`[${attribute}]`).forEach((element) => {
      element.removeAttribute(attribute);
    });
  });

  root.querySelectorAll("[style]").forEach((element) => {
    const sanitizedStyle = stripBackgroundImagesFromInlineStyle(element.getAttribute("style") || "");

    if (sanitizedStyle) {
      element.setAttribute("style", sanitizedStyle);
      return;
    }

    element.removeAttribute("style");
  });
}

function isFigureOrTableHeader(element) {
  if (!element) {
    return false;
  }

  if (element.closest("figure, .figure, .figure-wrap, .table-wrap, table")) {
    return true;
  }

  return Boolean(
    element.querySelector(
      [
        ".label",
        ".figure__label",
        ".table__label",
        "[data-figure-label]",
        "[data-table-label]",
      ].join(", ")
    )
  );
}

function removeAbstractSection(root) {
  root
    .querySelectorAll(
      [
        "#abstract",
        ".abstract",
        ".article__abstract",
        ".c-article-section__abstract",
        '[data-title="Abstract"]',
        '[aria-labelledby*="abstract"]',
      ].join(", ")
    )
    .forEach((element) => element.remove());

  root.querySelectorAll("section, div").forEach((element) => {
    const heading = element.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4");

    if (!heading) {
      return;
    }

    const headingText = heading.textContent.replace(/\s+/g, " ").trim().toLowerCase();

    if (headingText === "abstract" || headingText === "摘要") {
      element.remove();
    }
  });
}

function absolutizeNodeUrls(root, baseUrl) {
  const attributes = ["href", "src", "poster"];
  const dataAttributes = [
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-zoom-src",
    "data-hires",
  ];

  for (const attribute of attributes) {
    root.querySelectorAll(`[${attribute}]`).forEach((element) => {
      const value = element.getAttribute(attribute);
      const normalizedValue = absolutizeUrl(value, baseUrl);

      if (normalizedValue) {
        element.setAttribute(attribute, normalizedValue);
      }
    });
  }

  for (const attribute of dataAttributes) {
    root.querySelectorAll(`[${attribute}]`).forEach((element) => {
      const value = element.getAttribute(attribute);
      const normalizedValue = absolutizeUrl(value, baseUrl);

      if (normalizedValue) {
        element.setAttribute(attribute, normalizedValue);
      }
    });
  }

  root.querySelectorAll("[srcset]").forEach((element) => {
    const srcset = element.getAttribute("srcset");

    if (!srcset) {
      return;
    }

    const normalizedSrcset = srcset
      .split(",")
      .map((candidate) => {
        const [url, descriptor] = candidate.trim().split(/\s+/, 2);
        const normalizedUrl = absolutizeUrl(url, baseUrl);
        return normalizedUrl ? [normalizedUrl, descriptor].filter(Boolean).join(" ") : candidate;
      })
      .join(", ");

    element.setAttribute("srcset", normalizedSrcset);
  });

  root.querySelectorAll("[data-srcset]").forEach((element) => {
    const srcset = element.getAttribute("data-srcset");

    if (!srcset) {
      return;
    }

    const normalizedSrcset = srcset
      .split(",")
      .map((candidate) => {
        const [url, descriptor] = candidate.trim().split(/\s+/, 2);
        const normalizedUrl = absolutizeUrl(url, baseUrl);
        return normalizedUrl ? [normalizedUrl, descriptor].filter(Boolean).join(" ") : candidate;
      })
      .join(", ");

    element.setAttribute("data-srcset", normalizedSrcset);
  });

  hydrateLazyImages(root);
}

function absolutizeUrl(value, baseUrl) {
  if (
    !value ||
    value.startsWith("data:") ||
    value.startsWith("mailto:") ||
    value.startsWith("tel:") ||
    value.startsWith("javascript:")
  ) {
    return value;
  }

  if (value.startsWith("/api/") || value.startsWith("/storage/")) {
    return buildApiUrl(value);
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch (error) {
    return value;
  }
}

function hydrateLazyImages(root) {
  root.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";

    if (src && !isTransparentPlaceholder(src)) {
      return;
    }

    const lazySource =
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-zoom-src") ||
      img.getAttribute("data-hires");

    if (lazySource) {
      img.setAttribute("src", lazySource);
    }
  });

  root.querySelectorAll("source").forEach((source) => {
    const srcset = source.getAttribute("srcset") || "";

    if (srcset) {
      return;
    }

    const lazySrcset = source.getAttribute("data-srcset");

    if (lazySrcset) {
      source.setAttribute("srcset", lazySrcset);
    }
  });
}

function installArticleImageFallbacks(root, sourceUrl) {
  if (!root) {
    return;
  }

  root.querySelectorAll("img").forEach((img) => {
    if (img.dataset.paperShareFallbackBound === "true") {
      return;
    }

    img.dataset.paperShareFallbackBound = "true";

    const handleError = () => {
      renderArticleImageFallback(img, sourceUrl);
    };

    img.addEventListener("error", handleError);

    if (shouldRenderArticleImageFallback(img)) {
      handleError();
    }
  });
}

function shouldRenderArticleImageFallback(img) {
  if (!img || !img.isConnected || !img.complete) {
    return false;
  }

  const imageUrl = String(img.currentSrc || img.getAttribute("src") || "").trim();

  if (!imageUrl || isTransparentPlaceholder(imageUrl)) {
    return false;
  }

  return img.naturalWidth === 0;
}

function renderArticleImageFallback(img, sourceUrl) {
  if (!img || !img.isConnected) {
    return;
  }

  const fallbackHost = resolveArticleImageFallbackHost(img);

  if (!fallbackHost || fallbackHost.dataset.paperShareFallbackShown === "true") {
    return;
  }

  fallbackHost.dataset.paperShareFallbackShown = "true";
  fallbackHost.hidden = true;

  const fallback = document.createElement("div");
  fallback.className = "article-image-fallback";

  const message = document.createElement("p");
  message.className = "article-image-fallback-text";
  message.textContent =
    "图片加载不出来？点击“原文网址”，待新界面加载完成，再刷新本页面即可显示图片。（原文网址可能需要登录/人机验证）";
  fallback.append(message);

  if (sourceUrl) {
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "ghost-button article-image-fallback-button";
    actionButton.textContent = "原文网址";
    actionButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.open(sourceUrl, "_blank", "noopener,noreferrer");
    });
    fallback.append(actionButton);
  }

  fallbackHost.insertAdjacentElement("beforebegin", fallback);
}

function resolveArticleImageFallbackHost(img) {
  if (!img) {
    return null;
  }

  const picture = img.closest("picture");
  const anchor = img.closest("a");

  if (
    anchor &&
    anchor.childElementCount === 1 &&
    (anchor.firstElementChild === img || anchor.firstElementChild === picture)
  ) {
    return anchor;
  }

  return picture || img;
}

function isTransparentPlaceholder(value) {
  return (
    value.startsWith("data:image") &&
    /transparent|blank|1x1|pixel/i.test(value)
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

  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    if (window.location.hostname) {
      return window.location.origin;
    }
  }

  return DEFAULT_API_ORIGIN;
}

function readApiBaseUrlFromQuery() {
  try {
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
    const rawValue = String(
      window.localStorage.getItem(API_BASE_URL_STORAGE_KEY) || ""
    ).trim();

    if (!rawValue) {
      return "";
    }

    return new URL(rawValue).toString().replace(/\/$/, "");
  } catch (error) {
    return "";
  }
}

function buildApiUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return new URL(path, `${API_BASE_URL}/`).toString();
}

function readSessionToken() {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || "";
  } catch (error) {
    return "";
  }
}

function readStoredCurrentUser() {
  try {
    if (!window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)) {
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

function storeSessionToken(token) {
  sessionToken = String(token || "");

  try {
    if (sessionToken) {
      window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, sessionToken);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch (error) {
    // Ignore storage failures so private browsing still works with the in-memory token.
  }
}

function clearSessionToken() {
  storeSessionToken("");
}

function storeCurrentUser(user) {
  try {
    if (user && typeof user === "object" && String(user.id || "").trim()) {
      window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
    }
  } catch (error) {
    // Ignore storage failures so the app can continue with in-memory state.
  }
}

function clearStoredCurrentUser() {
  storeCurrentUser(null);
}

async function apiRequest(path, options = {}) {
  const isFormDataBody = options.body instanceof FormData;
  const requestOptions = {
    credentials: "include",
    headers: {
      ...(isFormDataBody ? {} : { "Content-Type": "application/json" }),
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
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
        `无法连接到 PaperShare 服务，请先运行 server.js，并确认页面能访问 ${API_BASE_URL}`
      );
    }

    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    clearSessionToken();
    clearStoredCurrentUser();
    state.currentUser = null;
    state.loginStatus = data.error || "登录已失效，请重新登录";
    resetAppForLoggedOutState();
    render();
  }

  if (response.ok && data.token) {
    storeSessionToken(data.token);
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
}

function readPaperRouteFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const panel = params.get("panel") === "discussion" ? "discussion" : "reader";
  return {
    paperId: params.get("paperId")?.trim() || "",
    panel,
    annotationId: params.get("annotationId")?.trim() || "",
    replyId: params.get("replyId")?.trim() || "",
    discussionId: params.get("discussionId")?.trim() || "",
    discussionReplyId: params.get("discussionReplyId")?.trim() || "",
  };
}

function readPaperIdFromHash() {
  return decodeURIComponent(window.location.hash.replace(/^#/, "").trim());
}

function writePaperIdToHash(paperId) {
  const nextHash = paperId ? `#${encodeURIComponent(paperId)}` : "";

  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
}

function buildPaperDetailUrl(options = {}) {
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

function openPaperDetail(options = {}) {
  window.location.href = buildPaperDetailUrl(options);
}

function handleBackToLibrary() {
  window.location.href = LIBRARY_INDEX_PATH;
}

function formatDateTime(value) {
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

function readLibraryLayoutRatios() {
  try {
    const rawValue = window.localStorage.getItem(getLibraryLayoutStorageKey());

    if (!rawValue) {
      return { ...EMPTY_LIBRARY_LAYOUT_RATIOS };
    }

    const parsed = JSON.parse(rawValue);
    const left = Number(parsed?.left);
    const right = Number(parsed?.right);

    return {
      left: Number.isFinite(left) && left > 0 ? left : null,
      right: Number.isFinite(right) && right > 0 ? right : null,
    };
  } catch (error) {
    return { ...EMPTY_LIBRARY_LAYOUT_RATIOS };
  }
}

function storeLibraryLayoutRatios(ratios) {
  try {
    window.localStorage.setItem(getLibraryLayoutStorageKey(), JSON.stringify(ratios));
  } catch (error) {
    // Ignore storage failures and keep the in-memory layout.
  }
}

function truncate(value, maxLength) {
  const normalizedValue = String(value || "");

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...`;
}

function formatMultilineHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function leftRatioForLayout(leftRatio) {
  return Number.isFinite(leftRatio) ? leftRatio : DEFAULT_TWO_PANE_SIDE_RATIO;
}

function rightRatioForLayout(rightRatio) {
  return Number.isFinite(rightRatio) ? rightRatio : DEFAULT_TWO_PANE_SIDE_RATIO;
}

function getLibraryLayoutStorageKey() {
  return `${LIBRARY_LAYOUT_STORAGE_KEY_PREFIX}_${IS_DETAIL_PAGE ? "detail" : "catalog"}`;
}

function hasCustomLibraryPaneLayout(ratios) {
  return Boolean(Number.isFinite(ratios?.left) || Number.isFinite(ratios?.right));
}
