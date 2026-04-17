import {
  applyAuthenticatedState,
  applyLoggedOutState,
  clearPersistedSession,
  createInitialCatalogState,
  createInitialDetailState,
  createInitialMembersState,
  createInitialProfileState,
  enterPasswordChangeRequiredState,
  getClientState,
  navigateToClientUrl,
  persistSessionToken,
  updateClientState,
} from "./client-store";
import type {
  AuthSessionState,
  DetailStoreModule,
  FocusReplyOptions,
  LoginResponse,
  PaperDetailUrlOptions,
  User,
} from "./types";

const LIBRARY_INDEX_PATH = "./index.html";
const PAPER_DETAIL_PATH = "./paper.html";

export async function initializeSession(): Promise<AuthSessionState> {
  updateClientState({
    auth: {
      ...getClientState().auth,
      isInitializing: true,
      loginStatus: "正在恢复登录状态...",
    },
  });

  try {
    const authState = await apiRequest<AuthSessionState>("/api/auth/me");

    if (authState.authenticated && authState.user) {
      applyAuthenticatedState(authState.user, `已登录为 ${authState.user.username}`);
    } else {
      clearPersistedSession();
      updateClientState({
        auth: {
          ...getClientState().auth,
          currentUser: null,
          serverReady: true,
          loginStatus: "请输入账号密码",
          databaseStatus: "服务已连接，请先登录",
        },
        papers: {
          items: [],
        },
        catalog: {
          ...createInitialCatalogState(null),
          paperFormStatus: "登录后可抓取文献",
        },
        profile: createInitialProfileState(),
        members: createInitialMembersState(),
        detail: createInitialDetailState(),
      });
    }
  } catch (error) {
    updateClientState({
      auth: {
        ...getClientState().auth,
        currentUser: null,
        serverReady: false,
        loginStatus: "无法连接服务",
        databaseStatus: `服务未启动（API: ${getClientState().session.apiBaseUrl}）`,
      },
      papers: {
        items: [],
      },
      catalog: {
        ...createInitialCatalogState(null),
        paperFormStatus: "请先启动 server.js",
      },
      profile: createInitialProfileState(),
      members: createInitialMembersState(),
      detail: createInitialDetailState(),
    });
    throw error;
  } finally {
    updateClientState({
      auth: {
        ...getClientState().auth,
        isInitializing: false,
      },
    });
  }

  return {
    authenticated: Boolean(getClientState().auth.currentUser),
    user: getClientState().auth.currentUser,
  };
}

export async function login({
  username,
  password,
}: {
  username: string;
  password: string;
}): Promise<LoginResponse> {
  updateClientState({
    auth: {
      ...getClientState().auth,
      isLoggingIn: true,
      loginStatus: "登录中...",
    },
  });

  try {
    const result = await apiRequest<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    applyAuthenticatedState(result.user, `已登录为 ${result.user.username}`);
    return result;
  } catch (error) {
    updateClientState({
      auth: {
        ...getClientState().auth,
        loginStatus: error instanceof Error ? error.message : "登录失败",
      },
    });
    throw error;
  } finally {
    updateClientState({
      auth: {
        ...getClientState().auth,
        isLoggingIn: false,
      },
    });
  }
}

export async function logout(): Promise<void> {
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

export function buildPaperDetailUrl(options: PaperDetailUrlOptions = {}): string {
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

export function openPaperDetail(input: string | PaperDetailUrlOptions): void {
  const options: PaperDetailUrlOptions =
    input && typeof input === "object" ? input : { paperId: input, panel: "reader" };

  if (!options.paperId) {
    return;
  }

  navigateToClientUrl(
    buildPaperDetailUrl({
      panel: "reader",
      ...options,
    })
  );
}

export function navigateToLibraryIndex(): void {
  navigateToClientUrl(LIBRARY_INDEX_PATH);
}

export async function openAnnotationLocation(
  paperId: string,
  annotationId: string,
  options: FocusReplyOptions = {}
): Promise<void> {
  const detailStore = (await import("../detail/detail-store")) as DetailStoreModule;
  return detailStore.openAnnotationLocation(paperId, annotationId, options);
}

export async function openDiscussionLocation(
  paperId: string,
  discussionId: string,
  options: FocusReplyOptions = {}
): Promise<void> {
  const detailStore = (await import("../detail/detail-store")) as DetailStoreModule;
  return detailStore.openDiscussionLocation(paperId, discussionId, options);
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
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

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return new URL(path, `${getClientState().session.apiBaseUrl}/`).toString();
}

export async function apiRequest<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const state = getClientState();
  const isFormDataBody = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormDataBody ? {} : { "Content-Type": "application/json" }),
    ...(state.session.token ? { Authorization: `Bearer ${state.session.token}` } : {}),
    ...normalizeHeaders(options.headers),
  };
  const requestOptions: RequestInit = {
    credentials: "include",
    headers,
    ...options,
  };

  if (requestOptions.method === "GET" || requestOptions.method === "DELETE" || isFormDataBody) {
    delete headers["Content-Type"];
  }

  let response;

  try {
    response = await fetch(buildApiUrl(path), requestOptions);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `无法连接到 PaperShare 服务，请先运行 server.js，并确认页面能访问 ${getClientState().session.apiBaseUrl}`
      );
    }

    throw error;
  }

  const data = await response.json().catch(() => ({} as Record<string, unknown>));

  if (response.status === 401) {
    applyLoggedOutState(readErrorMessage(data, "登录已失效，请重新登录"));
  }

  if (response.status === 403 && readStringField(data, "code") === "PASSWORD_CHANGE_REQUIRED") {
    const nextUser = {
      ...(getClientState().auth.currentUser || {}),
      mustChangePassword: true,
    } as User;

    enterPasswordChangeRequiredState(nextUser);
  }

  const token = readStringField(data, "token");

  if (response.ok && token) {
    persistSessionToken(token);
    updateClientState({
      session: {
        ...getClientState().session,
        token,
      },
    });
  }

  if (!response.ok) {
    throw new Error(readErrorMessage(data, `Request failed with status ${response.status}`));
  }

  return data as T;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)])
  );
}

function readStringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return value == null ? "" : String(value);
}

function readErrorMessage(source: Record<string, unknown>, fallback: string): string {
  return readStringField(source, "error") || fallback;
}
