import { useEffect, useState } from "preact/hooks";

const DEFAULT_API_ORIGIN = "http://127.0.0.1:3000";
const API_BASE_URL_STORAGE_KEY = "papershare_api_base_url";
const SESSION_TOKEN_STORAGE_KEY = "papershare_session_token";
const CURRENT_USER_STORAGE_KEY = "papershare_current_user";
const PAPER_DETAIL_PATH = "./paper.html";

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
    });
    return [];
  }

  const papers = await apiRequest("/api/papers");
  const sortedPapers = [...papers].sort(comparePapersForList);

  updateClientState({
    papers: {
      items: sortedPapers,
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

export function openPaperDetail(paperId) {
  if (!paperId) {
    return;
  }

  navigateToUrl(buildPaperDetailUrl({ paperId, panel: "reader" }));
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
  };
}

function emitClientState() {
  listeners.forEach((listener) => {
    listener(clientState);
  });
}

function updateClientState(partial) {
  clientState = mergeClientState(clientState, typeof partial === "function" ? partial(clientState) : partial);
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
    catalog: partialState.catalog ? { ...baseState.catalog, ...partialState.catalog } : baseState.catalog,
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
  });
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
