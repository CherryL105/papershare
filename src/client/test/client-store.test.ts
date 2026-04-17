// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getClientState,
  resetClientStoreForTests,
  setClientStateForTests,
} from "../shared/client-store";
import {
  changePassword,
  changeUsername,
  createUser,
  initializeCatalogPage,
  submitPaper,
  transferAdmin,
} from "../catalog/catalog-store";

function createJsonResponse(body: any, init: { status?: number } = {}) {
  return {
    ok: init.status ? init.status < 400 : true,
    status: init.status ?? 200,
    json: async () => body,
  } as any;
}

function createUserRecord(overrides = {}) {
  return {
    id: "user-1",
    username: "alice",
    createdAt: "2026-04-16T00:00:00.000Z",
    role: "member",
    ...overrides,
  };
}

function createPaper(overrides = {}) {
  return {
    id: "paper-1",
    title: "Alpha paper",
    createdAt: "2026-04-16T00:00:00.000Z",
    latestSpeechAt: "2026-04-16T00:30:00.000Z",
    created_by_username: "alice",
    ...overrides,
  };
}

beforeEach(() => {
  document.body.dataset.page = "catalog";
  globalThis.fetch = vi.fn() as any;
  resetClientStoreForTests();
});

afterEach(() => {
  resetClientStoreForTests();
  vi.restoreAllMocks();
});

describe("client store", () => {
  it("initializes the catalog page and loads papers, dashboard, and members", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url.endsWith("/api/auth/me")) {
        return createJsonResponse({
          authenticated: true,
          user: createUserRecord(),
        });
      }

      if (url.endsWith("/api/status")) {
        return createJsonResponse({ ok: true });
      }

      if (url.endsWith("/api/papers")) {
        return createJsonResponse([
          createPaper({ id: "paper-1", title: "Older paper", latestSpeechAt: "2026-04-16T00:30:00.000Z" }),
          createPaper({ id: "paper-2", title: "Newer paper", latestSpeechAt: "2026-04-16T02:30:00.000Z" }),
        ]);
      }

      if (url.endsWith("/api/me/dashboard")) {
        return createJsonResponse({
          myAnnotations: [],
          repliesToMyAnnotations: [],
          uploadedPapers: [createPaper()],
        });
      }

      if (url.endsWith("/api/users")) {
        return createJsonResponse([
          createUserRecord(),
          createUserRecord({ id: "user-2", username: "bob" }),
        ]);
      }

      if (url.endsWith("/api/users/user-2/profile")) {
        return createJsonResponse({
          annotations: [],
          uploadedPapers: [createPaper({ id: "paper-3", title: "Bob paper" })],
          user: createUserRecord({ id: "user-2", username: "bob" }),
        });
      }

      return createJsonResponse({});
    }) as any;

    const authState = await initializeCatalogPage();

    expect(authState.authenticated).toBe(true);
    expect(getClientState().auth.currentUser?.username).toBe("alice");
    expect(getClientState().auth.databaseStatus).toBe("服务已连接");
    expect(getClientState().papers.items.map((paper) => paper.id)).toEqual(["paper-2", "paper-1"]);
    expect(getClientState().profile.uploadedPapers).toHaveLength(1);
    expect(getClientState().members.selectedMemberId).toBe("user-2");
    expect(getClientState().members.selectedMemberProfile?.user.username).toBe("bob");
  });

  it("refreshes dependent catalog data after changing username", async () => {
    globalThis.fetch = vi.fn(async (input, init: any) => {
      const url = String(input);

      if (url.endsWith("/api/me/username")) {
        expect(init?.method).toBe("POST");
        return createJsonResponse({
          ok: true,
          user: createUserRecord({ username: "alice-renamed" }),
        });
      }

      if (url.endsWith("/api/papers")) {
        return createJsonResponse([createPaper({ created_by_username: "alice-renamed" })]);
      }

      if (url.endsWith("/api/me/dashboard")) {
        return createJsonResponse({
          myAnnotations: [],
          repliesToMyAnnotations: [],
          uploadedPapers: [createPaper({ created_by_username: "alice-renamed" })],
        });
      }

      if (url.endsWith("/api/users")) {
        return createJsonResponse([
          createUserRecord({ username: "alice-renamed" }),
          createUserRecord({ id: "user-2", username: "bob" }),
        ]);
      }

      if (url.endsWith("/api/users/user-2/profile")) {
        return createJsonResponse({
          annotations: [],
          uploadedPapers: [],
          user: createUserRecord({ id: "user-2", username: "bob" }),
        });
      }

      if (url.endsWith("/api/papers/paper-1/annotations")) {
        return createJsonResponse([]);
      }

      if (url.endsWith("/api/papers/paper-1/discussions")) {
        return createJsonResponse([]);
      }

      return createJsonResponse({});
    }) as any;

    setClientStateForTests({
      auth: {
        currentUser: createUserRecord(),
        isInitializing: false,
        serverReady: true,
      },
      detail: {
        selectedPaperId: "paper-1",
      },
      members: {
        selectedMemberId: "user-2",
      },
    } as any);

    await changeUsername({ username: "alice-renamed" });

    expect(getClientState().auth.currentUser?.username).toBe("alice-renamed");
    expect(getClientState().auth.loginStatus).toBe("已登录为 alice-renamed");
    expect(getClientState().profile.usernameStatus).toBe("用户名更新成功");
    expect(getClientState().papers.items[0]?.created_by_username).toBe("alice-renamed");
    expect(getClientState().members.allUsers[0]?.username).toBe("alice-renamed");
    expect(getClientState().detail.selectedPaperId).toBe("paper-1");
    expect((globalThis.fetch as any).mock.calls.some(([input]: any) => String(input).endsWith("/api/papers/paper-1/annotations"))).toBe(
      true
    );
    expect((globalThis.fetch as any).mock.calls.some(([input]: any) => String(input).endsWith("/api/papers/paper-1/discussions"))).toBe(
      true
    );
  });

  it("clears the must-change-password gate after a successful password update", async () => {
    globalThis.fetch = vi.fn(async (input, init: any) => {
      const url = String(input);

      if (url.endsWith("/api/me/password")) {
        expect(init?.method).toBe("POST");
        return createJsonResponse({ ok: true });
      }

      if (url.endsWith("/api/auth/me")) {
        return createJsonResponse({
          authenticated: true,
          user: createUserRecord({ mustChangePassword: false }),
        });
      }

      if (url.endsWith("/api/status")) {
        return createJsonResponse({ ok: true });
      }

      if (url.endsWith("/api/papers")) {
        return createJsonResponse([]);
      }

      if (url.endsWith("/api/me/dashboard")) {
        return createJsonResponse({
          myAnnotations: [],
          repliesToMyAnnotations: [],
          uploadedPapers: [],
        });
      }

      if (url.endsWith("/api/users")) {
        return createJsonResponse([createUserRecord({ mustChangePassword: false })]);
      }

      return createJsonResponse({});
    }) as any;

    setClientStateForTests({
      auth: {
        currentUser: createUserRecord({ mustChangePassword: true }),
        isInitializing: false,
        serverReady: true,
      },
      catalog: {
        currentView: "password",
      },
      profile: {
        passwordStatus: "首次登录后请先修改初始密码",
      },
    } as any);

    await changePassword({
      confirmPassword: "pass1234",
      currentPassword: "old-pass",
      nextPassword: "pass1234",
    });

    expect(getClientState().auth.currentUser?.mustChangePassword).toBe(false);
    expect(getClientState().catalog.currentView).toBe("profile");
    expect(getClientState().profile.passwordStatus).toBe("密码更新成功");
  });

  it("creates a new user and then transfers admin permissions", async () => {
    let usersRequestCount = 0;

    globalThis.fetch = vi.fn(async (input, init: any) => {
      const url = String(input);
      const method = init?.method || "GET";

      if (url.endsWith("/api/users") && method === "POST") {
        return createJsonResponse({
          ok: true,
          user: createUserRecord({ id: "user-2", username: "bob" }),
        });
      }

      if (url.endsWith("/api/users/user-2/transfer-admin")) {
        return createJsonResponse({
          currentUser: createUserRecord({ role: "member" }),
          ok: true,
          targetUser: createUserRecord({ id: "user-2", role: "admin", username: "bob" }),
        });
      }

      if (url.endsWith("/api/me/dashboard")) {
        return createJsonResponse({
          myAnnotations: [],
          repliesToMyAnnotations: [],
          uploadedPapers: [],
        });
      }

      if (url.endsWith("/api/users") && method === "GET") {
        usersRequestCount += 1;
        return createJsonResponse([
          createUserRecord({ role: usersRequestCount > 1 ? "member" : "admin" }),
          createUserRecord({ id: "user-2", username: "bob", role: usersRequestCount > 1 ? "admin" : "member" }),
        ]);
      }

      if (url.endsWith("/api/users/user-2/profile")) {
        return createJsonResponse({
          annotations: [],
          uploadedPapers: [],
          user: createUserRecord({ id: "user-2", username: "bob" }),
        });
      }

      return createJsonResponse({});
    }) as any;

    setClientStateForTests({
      auth: {
        currentUser: createUserRecord({ role: "admin" }),
        isInitializing: false,
        serverReady: true,
      },
      members: {
        allUsers: [createUserRecord({ role: "admin" })],
      },
    } as any);

    await createUser({
      confirmPassword: "pass1234",
      password: "pass1234",
      username: "bob",
    });

    expect(getClientState().members.userManagementStatus).toBe("用户 bob 创建成功");

    await transferAdmin("user-2");

    expect(getClientState().auth.currentUser?.role).toBe("member");
    expect(getClientState().catalog.currentView).toBe("profile");
    expect(getClientState().members.userManagementStatus).toBe("管理员身份已转让给 bob");
  });

  it("uses the HTML import endpoint when raw HTML is provided", async () => {
    globalThis.fetch = vi.fn(async (input, init: any) => {
      const url = String(input);

      if (url.endsWith("/api/papers/import-html")) {
        expect(init?.method).toBe("POST");
        return createJsonResponse({
          id: "paper-3",
          title: "Imported paper",
          createdAt: "2026-04-16T00:00:00.000Z",
          latestSpeechAt: "2026-04-16T00:00:00.000Z",
        });
      }

      if (url.endsWith("/api/papers")) {
        return createJsonResponse([
          {
            id: "paper-3",
            title: "Imported paper",
            createdAt: "2026-04-16T00:00:00.000Z",
            latestSpeechAt: "2026-04-16T00:00:00.000Z",
          },
        ]);
      }

      return createJsonResponse({});
    }) as any;

    setClientStateForTests({
      auth: {
        isInitializing: false,
        serverReady: true,
        currentUser: createUserRecord(),
      },
    } as any);

    const savedPaper = await submitPaper({
      sourceUrl: "https://example.org/paper",
      rawHtml: "<html><body>snapshot</body></html>",
    });

    expect(savedPaper.id).toBe("paper-3");
    expect(getClientState().catalog.paperFormStatus).toBe("源码导入成功，已写入 storage");
    expect(getClientState().papers.items.map((paper) => paper.id)).toEqual(["paper-3"]);
  });
});
