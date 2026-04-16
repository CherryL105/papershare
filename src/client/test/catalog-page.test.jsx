// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogPage } from "../catalog/CatalogPage.jsx";
import {
  resetClientStoreForTests,
  setClientStateForTests,
  setNavigationHandlerForTests,
} from "../shared/client-store.js";

function createJsonResponse(body, init = {}) {
  return {
    ok: init.status ? init.status < 400 : true,
    status: init.status ?? 200,
    json: async () => body,
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

const originalWindowAlert = window.alert;
const originalWindowOpen = window.open;
let navigateToUrlSpy;

beforeEach(() => {
  document.body.dataset.page = "catalog";
  window.alert = vi.fn();
  window.open = vi.fn();
  globalThis.fetch = vi.fn();
  resetClientStoreForTests({
    auth: {
      isInitializing: false,
      serverReady: true,
      databaseStatus: "服务已连接，请先登录",
    },
    catalog: {
      paperFormStatus: "登录后可抓取文献",
    },
  });
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
  it("renders the logged-out catalog experience with the legacy panels still mounted", () => {
    render(<CatalogPage />);

    expect(screen.getByRole("heading", { name: "上传新文章" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "抓取并上传" }).disabled).toBe(true);
    expect(document.querySelector("#paper-list")?.textContent).toContain("storage 文件夹中还没有文献。");
    expect(document.querySelector("#profile-view")).not.toBeNull();
    expect(document.querySelector("#password-view")).not.toBeNull();
    expect(document.querySelector("#user-management-view")).not.toBeNull();
    expect(document.querySelector("#members-view")).not.toBeNull();
  });

  it("renders papers from the shared store and filters them by search term", async () => {
    setClientStateForTests({
      auth: {
        currentUser: {
          id: "user-1",
          username: "alice",
          createdAt: "2026-04-16T00:00:00.000Z",
        },
      },
      papers: {
        items: [
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
      },
    });

    render(<CatalogPage />);

    expect(document.querySelector("#paper-count")?.textContent).toBe("2 / 2 篇");
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

  it("submits a paper URL through the shared store and navigates to the detail page", async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);

      if (url.endsWith("/api/papers") && init?.method === "POST") {
        expect(init?.method).toBe("POST");
        return createJsonResponse(createPaper({ id: "paper-3", title: "Gamma paper" }));
      }

      if (url.endsWith("/api/papers")) {
        return createJsonResponse([createPaper({ id: "paper-3", title: "Gamma paper" })]);
      }

      return createJsonResponse({});
    });

    setClientStateForTests({
      auth: {
        currentUser: {
          id: "user-1",
          username: "alice",
          createdAt: "2026-04-16T00:00:00.000Z",
        },
      },
    });

    render(<CatalogPage />);

    fireEvent.input(screen.getByPlaceholderText("https://example.org/paper"), {
      target: { value: "https://example.org/paper" },
    });
    fireEvent.submit(document.querySelector("#paper-form"));

    await waitFor(() => {
      expect(navigateToUrlSpy).toHaveBeenCalledWith("./paper.html?paperId=paper-3&panel=reader");
    });

    expect(document.querySelector("#paper-form-status")?.textContent).toBe("抓取成功，已写入 storage");
  });

  it("shows the browser fallback guidance when the remote fetch needs manual verification", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url.endsWith("/api/papers")) {
        return createJsonResponse({ error: "403 Forbidden" }, { status: 403 });
      }

      return createJsonResponse([]);
    });

    setClientStateForTests({
      auth: {
        currentUser: {
          id: "user-1",
          username: "alice",
          createdAt: "2026-04-16T00:00:00.000Z",
        },
      },
    });

    render(<CatalogPage />);

    fireEvent.input(screen.getByPlaceholderText("https://example.org/paper"), {
      target: { value: "https://www.sciencedirect.com/science/article/pii/example" },
    });
    fireEvent.submit(document.querySelector("#paper-form"));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledTimes(1);
    });

    expect(document.querySelector("#paper-form-status")?.textContent).toBe(
      "目标站点需要人工验证，请改用浏览器打开原文并导入 HTML 快照"
    );
  });
});
