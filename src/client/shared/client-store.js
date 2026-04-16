import { useEffect, useState } from "preact/hooks";
import * as sharedModule from "../../../shared/papershare-shared.js";
import {
  createEmptyComposerState,
  createEmptyEditState,
} from "./speech-helpers.js";

const shared = sharedModule?.default || sharedModule;
const {
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  isAdminUser,
  isDiscussionReply,
  isReplyAnnotation,
} = shared;

export const DEFAULT_API_ORIGIN = "http://127.0.0.1:3000";
export const API_BASE_URL_STORAGE_KEY = "papershare_api_base_url";
export const SESSION_TOKEN_STORAGE_KEY = "papershare_session_token";
export const CURRENT_USER_STORAGE_KEY = "papershare_current_user";
export const CATALOG_VIEWS = Object.freeze({
  library: "library",
  members: "members",
  password: "password",
  profile: "profile",
  userManagement: "user-management",
});

const listeners = new Set();
let navigateToUrl = defaultNavigateToUrl;
let clientState = createInitialClientState();

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

export function updateClientState(partial) {
  clientState = mergeClientState(
    clientState,
    typeof partial === "function" ? partial(clientState) : partial
  );
  emitClientState();
  return clientState;
}

export function createInitialCatalogState(currentUser = null) {
  return {
    currentView: requiresPasswordChange(currentUser) ? CATALOG_VIEWS.password : CATALOG_VIEWS.library,
    profilePanel: "papers",
    memberProfilePanel: "papers",
    paperFormStatus: requiresPasswordChange(currentUser) ? "修改密码后可抓取文献" : "等待抓取",
    searchTerm: "",
    isSavingPaper: false,
  };
}

export function createInitialProfileState() {
  return {
    uploadedPapers: [],
    myAnnotations: [],
    repliesToMyAnnotations: [],
    usernameStatus: "请输入新的用户名",
    passwordStatus: "请输入当前密码和新密码",
    isUpdatingUsername: false,
    isChangingPassword: false,
  };
}

export function createInitialMembersState() {
  return {
    allUsers: [],
    groupMembers: [],
    selectedMemberId: "",
    selectedMemberProfile: null,
    userManagementStatus: "管理员可以创建新的普通用户",
    isCreatingUser: false,
    isManagingUser: false,
    managedUserActionUserId: "",
    managedUserActionType: "",
  };
}

export function createInitialDetailState() {
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

export function mergeClientState(baseState, partialState = {}) {
  return {
    ...baseState,
    ...partialState,
    session: partialState.session ? { ...baseState.session, ...partialState.session } : baseState.session,
    auth: partialState.auth ? { ...baseState.auth, ...partialState.auth } : baseState.auth,
    papers: partialState.papers ? { ...baseState.papers, ...partialState.papers } : baseState.papers,
    catalog: partialState.catalog
      ? { ...baseState.catalog, ...partialState.catalog }
      : baseState.catalog,
    profile: partialState.profile
      ? { ...baseState.profile, ...partialState.profile }
      : baseState.profile,
    members: partialState.members
      ? { ...baseState.members, ...partialState.members }
      : baseState.members,
    detail: partialState.detail ? mergeDetailState(baseState.detail, partialState.detail) : baseState.detail,
  };
}

export function applyAuthenticatedState(user, loginStatus) {
  persistCurrentUser(user);
  updateClientState({
    auth: {
      currentUser: user,
      serverReady: true,
      loginStatus,
      databaseStatus: requiresPasswordChange(user) ? "已登录，需先修改初始密码" : "服务已连接",
    },
    catalog: {
      currentView: normalizeCatalogView(clientState.catalog.currentView, user),
      paperFormStatus: user?.mustChangePassword ? "修改密码后可抓取文献" : "等待抓取",
    },
  });
}

export function applyLoggedOutState(loginStatus) {
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
      ...createInitialCatalogState(null),
      isSavingPaper: false,
      paperFormStatus: clientState.auth.serverReady ? "登录后可抓取文献" : "请先启动 server.js",
    },
    profile: createInitialProfileState(),
    members: createInitialMembersState(),
    detail: createInitialDetailState(),
  });
}

export function resolveDetailFocusState(annotations, discussions, options = {}) {
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

export function requiresPasswordChange(user = clientState.auth.currentUser) {
  return Boolean(user?.mustChangePassword);
}

export function normalizeCatalogView(viewName, user = clientState.auth.currentUser) {
  if (!user) {
    return CATALOG_VIEWS.library;
  }

  if (requiresPasswordChange(user)) {
    return CATALOG_VIEWS.password;
  }

  if (viewName === CATALOG_VIEWS.members) {
    return CATALOG_VIEWS.members;
  }

  if (viewName === CATALOG_VIEWS.profile) {
    return CATALOG_VIEWS.profile;
  }

  if (viewName === CATALOG_VIEWS.password) {
    return CATALOG_VIEWS.password;
  }

  if (viewName === CATALOG_VIEWS.userManagement) {
    return isCurrentUserAdmin(user) ? CATALOG_VIEWS.userManagement : CATALOG_VIEWS.profile;
  }

  return CATALOG_VIEWS.library;
}

export function isCurrentUserAdmin(user = clientState.auth.currentUser) {
  return isAdminUser(user);
}

export function enterPasswordChangeRequiredState(user) {
  const nextUser = user
    ? {
        ...user,
        mustChangePassword: true,
      }
    : {
        ...(clientState.auth.currentUser || {}),
        mustChangePassword: true,
      };

  persistCurrentUser(nextUser);
  updateClientState({
    auth: {
      currentUser: nextUser,
      databaseStatus: "已登录，需先修改初始密码",
    },
    papers: {
      items: [],
    },
    catalog: {
      currentView: CATALOG_VIEWS.password,
      paperFormStatus: "修改密码后可抓取文献",
    },
    profile: {
      ...createInitialProfileState(),
      usernameStatus: "首次改密完成前，用户名暂时不可修改",
      passwordStatus: "首次登录后请先修改初始密码",
    },
    members: {
      ...createInitialMembersState(),
      userManagementStatus: "首次改密完成前，用户管理功能暂不可用",
    },
    detail: createInitialDetailState(),
  });
}

export function persistSessionToken(token) {
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

export function persistCurrentUser(user) {
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

export function clearPersistedSession() {
  persistSessionToken("");
  persistCurrentUser(null);
}

export function navigateToClientUrl(url) {
  navigateToUrl(url);
}

export function isDetailPage() {
  return typeof document !== "undefined" && document.body?.dataset?.page === "detail";
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
    catalog: createInitialCatalogState(currentUser),
    profile: createInitialProfileState(),
    members: createInitialMembersState(),
    detail: createInitialDetailState(),
  };
}

function emitClientState() {
  listeners.forEach((listener) => {
    listener(clientState);
  });
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

function defaultNavigateToUrl(url) {
  if (typeof window === "undefined") {
    return;
  }

  window.location.assign(url);
}
