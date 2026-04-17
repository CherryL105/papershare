// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogPage } from "../catalog/CatalogPage";
import { resetClientStoreForTests, setNavigationHandlerForTests } from "../shared/client-store";

function createJsonResponse(body: any, init: { status?: number } = {}) {
  return {
    ok: init.status ? init.status < 400 : true,
    status: init.status ?? 200,
    json: async () => body,
  } as any;
}

function createUser(overrides = {}) {
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
    authors: "Alice",
    journal: "Nature",
    abstract: "Alpha abstract",
    keywords: ["alpha"],
    created_by_username: "alice",
    created_at: "2026-04-16T00:00:00.000Z",
    createdAt: "2026-04-16T00:00:00.000Z",
    latestSpeechAt: "2026-04-16T01:00:00.000Z",
    latestSpeakerUsername: "alice",
    speech_count: 2,
    ...overrides,
  };
}

function createCatalogFetch({
  authMe = { authenticated: false, user: null },
  dashboard = {
    myAnnotations: [],
    repliesToMyAnnotations: [],
    uploadedPapers: [],
  },
  extra,
  memberProfiles = {},
  papers = [],
  status = { ok: true },
  users = [],
}: any = {}) {
  return vi.fn(async (input, init: any = {}) => {
    const url = String(input);
    const method = init?.method || "GET";

    if (url.endsWith("/api/auth/me")) {
      return createJsonResponse(authMe);
    }

    if (url.endsWith("/api/status")) {
      return createJsonResponse(status);
    }

    if (url.endsWith("/api/papers") && method === "GET") {
      return createJsonResponse(papers);
    }

    if (url.endsWith("/api/me/dashboard")) {
      return createJsonResponse(dashboard);
    }

    if (url.endsWith("/api/users") && method === "GET") {
      return createJsonResponse(users);
    }

    for (const [userId, profile] of Object.entries(memberProfiles)) {
      if (url.endsWith(`/api/users/${encodeURIComponent(userId)}/profile`)) {
        return createJsonResponse(profile);
      }
    }

    if (typeof extra === "function") {
      const response = await extra({ init, method, url });

      if (response) {
        return response;
      }
    }

    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

const originalWindowAlert = window.alert;
const originalWindowOpen = window.open;
let navigateToUrlSpy: any;

beforeEach(() => {
  document.body.dataset.page = "catalog";
  window.alert = vi.fn();
  window.open = vi.fn();
  globalThis.fetch = vi.fn() as any;
  resetClientStoreForTests();
  navigateToUrlSpy = vi.fn();
  setNavigationHandlerForTests(navigateToUrlSpy);
});

afterEach(() => {
  cleanup();
  resetClientStoreForTests();
  vi.restoreAllMocks();
  window.alert = originalWindowAlert;
  window.open = originalWindowOpen;
});

describe("catalog page", () => {
  it("renders the logged-out catalog experience through React", async () => {
    globalThis.fetch = createCatalogFetch() as any;

    render(<CatalogPage />);

    await waitFor(() => {
      expect(document.querySelector("#login-status")?.textContent).toBe("请输入账号密码");
    });

    expect(screen.getByRole("heading", { name: "上传新文章" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "抓取并上传" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("#library-view")).not.toBeNull();
  });

  it("loads papers through initializeCatalogPage and filters them", async () => {
    globalThis.fetch = createCatalogFetch({
      authMe: {
        authenticated: true,
        user: createUser(),
      },
      papers: [
        createPaper(),
        createPaper({
          id: "paper-2",
          title: "Beta paper",
          authors: "Bob",
          journal: "Science",
          abstract: "Beta abstract",
          keywords: ["beta"],
          created_by_username: "bob",
          latestSpeechAt: "2026-04-16T02:00:00.000Z",
          latestSpeakerUsername: "bob",
        }),
      ],
      users: [createUser()],
    }) as any;

    render(<CatalogPage />);

    await waitFor(() => {
      expect(document.querySelector("#paper-count")?.textContent).toBe("2 / 2 篇");
    });

    expect(screen.getByText("Alpha paper")).toBeTruthy();
    expect(screen.getByText("Beta paper")).toBeTruthy();

    fireEvent.input(screen.getByPlaceholderText("按标题、作者、摘要、关键词、上传人搜索"), {
      target: { value: "beta" },
    });

    await waitFor(() => {
      expect(document.querySelector("#paper-count")?.textContent).toBe("1 / 2 篇");
    });

    expect(screen.queryByText("Alpha paper")).toBeNull();
    expect(screen.getByText("Beta paper")).toBeTruthy();
  });

  it("switches across the React profile and members views", async () => {
    globalThis.fetch = createCatalogFetch({
      authMe: {
        authenticated: true,
        user: createUser({ role: "admin" }),
      },
      dashboard: {
        myAnnotations: [],
        repliesToMyAnnotations: [],
        uploadedPapers: [createPaper()],
      },
      memberProfiles: {
        "user-2": {
          annotations: [],
          uploadedPapers: [createPaper({ id: "paper-2", title: "Bob paper" })],
          user: createUser({ id: "user-2", username: "bob" }),
        },
      },
      papers: [createPaper()],
      users: [createUser({ role: "admin" }), createUser({ id: "user-2", username: "bob" })],
    }) as any;

    render(<CatalogPage />);

    await waitFor(() => {
      expect(document.querySelector("#library-view")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "个人中心" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "个人中心" }).classList.contains("active")).toBe(true);
    }, { timeout: 2000 });

    await waitFor(() => {
      expect(document.querySelector("#profile-view")).not.toBeNull();
    });

    await waitFor(() => {
      expect(document.querySelector("#profile-view")?.classList.contains("is-hidden")).toBe(false);
    });

    expect(document.querySelector("#profile-summary")?.textContent).toContain("alice");
    expect(screen.getByRole("button", { name: "用户管理" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "组员动向" }));

    await waitFor(() => {
      expect(document.querySelector("#members-view")).not.toBeNull();
    });

    await waitFor(() => {
      expect(document.querySelector("#members-view")?.classList.contains("is-hidden")).toBe(false);
    });

    await waitFor(() => {
      expect(document.querySelector("#member-profile-paper-list")?.textContent).toContain("Bob paper");
    });

    fireEvent.click(document.querySelector("#member-profile-paper-list .ghost-button") as HTMLElement);

    expect(navigateToUrlSpy).toHaveBeenCalledWith("./paper.html?paperId=paper-2&panel=reader");
  });

  it("locks the catalog into the password view when the user must change password", async () => {
    globalThis.fetch = createCatalogFetch({
      authMe: {
        authenticated: true,
        user: createUser({ mustChangePassword: true }),
      },
    }) as any;

    render(<CatalogPage />);

    await waitFor(() => {
      expect(document.querySelector("#password-view")?.classList.contains("is-hidden")).toBe(false);
    });

    expect((document.querySelector("#password-back-button") as HTMLButtonElement)?.disabled).toBe(true);
    expect((document.querySelector("#library-view-button") as HTMLButtonElement)?.disabled).toBe(true);
    expect((document.querySelector("#profile-view-button") as HTMLButtonElement)?.disabled).toBe(true);
    expect((document.querySelector("#member-view-button") as HTMLButtonElement)?.disabled).toBe(true);
    expect(document.querySelector("#password-status")?.textContent).toContain("首次登录后请先修改初始密码");
  });

  it("submits a paper URL through the shared store and navigates to the detail page", async () => {
    globalThis.fetch = createCatalogFetch({
      authMe: {
        authenticated: true,
        user: createUser(),
      },
      extra: async ({ init, method, url }: any) => {
        if (url.endsWith("/api/papers") && method === "POST") {
          expect(init?.method).toBe("POST");
          return createJsonResponse(createPaper({ id: "paper-3", title: "Gamma paper" }));
        }

        if (url.endsWith("/api/papers") && method === "GET") {
          return createJsonResponse([createPaper({ id: "paper-3", title: "Gamma paper" })]);
        }

        return null;
      },
      users: [createUser()],
    }) as any;

    render(<CatalogPage />);

    await waitFor(() => {
      expect(document.querySelector("#auth-gate")?.classList.contains("is-hidden")).toBe(true);
    });

    fireEvent.input(screen.getByPlaceholderText("https://example.org/paper"), {
      target: { value: "https://example.org/paper" },
    });
    fireEvent.submit(document.querySelector("#paper-form") as HTMLElement);

    await waitFor(() => {
      expect(navigateToUrlSpy).toHaveBeenCalledWith("./paper.html?paperId=paper-3&panel=reader");
    });

    expect(document.querySelector("#paper-form-status")?.textContent).toBe("抓取成功，已写入 storage");
  });

  it("shows the browser fallback guidance when the remote fetch needs manual verification", async () => {
    globalThis.fetch = createCatalogFetch({
      authMe: {
        authenticated: true,
        user: createUser(),
      },
      extra: async ({ method, url }: any) => {
        if (url.endsWith("/api/papers") && method === "POST") {
          return createJsonResponse({ error: "403 Forbidden" }, { status: 403 });
        }

        return null;
      },
      users: [createUser()],
    }) as any;

    render(<CatalogPage />);

    await waitFor(() => {
      expect(document.querySelector("#auth-gate")?.classList.contains("is-hidden")).toBe(true);
    });

    fireEvent.input(screen.getByPlaceholderText("https://example.org/paper"), {
      target: { value: "https://www.sciencedirect.com/science/article/pii/example" },
    });
    fireEvent.submit(document.querySelector("#paper-form") as HTMLElement);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledTimes(1);
    });

    expect(document.querySelector("#paper-form-status")?.textContent).toBe(
      "目标站点需要人工验证，请改用浏览器打开原文并导入 HTML 快照"
    );
  });
});
