// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailPage } from "../detail/DetailPage.jsx";
import {
  resetClientStoreForTests,
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
    abstract: "Alpha abstract",
    journal: "Nature",
    sourceUrl: "https://example.org/papers/alpha",
    created_by_user_id: "user-1",
    created_by_username: "alice",
    createdAt: "2026-04-16T00:00:00.000Z",
    latestSpeechAt: "2026-04-16T02:00:00.000Z",
    hasSnapshot: true,
    ...overrides,
  };
}

function createAnnotation(overrides = {}) {
  return {
    id: "annotation-1",
    paperId: "paper-1",
    note: "Alpha annotation",
    exact: "Alpha",
    prefix: "",
    suffix: " body",
    target_scope: "body",
    start_offset: 0,
    end_offset: 5,
    created_at: "2026-04-16T03:00:00.000Z",
    created_by_user_id: "user-1",
    created_by_username: "alice",
    attachments: [],
    ...overrides,
  };
}

function createDiscussion(overrides = {}) {
  return {
    id: "discussion-1",
    paperId: "paper-1",
    note: "Alpha discussion",
    created_at: "2026-04-16T04:00:00.000Z",
    created_by_user_id: "user-2",
    created_by_username: "bob",
    attachments: [],
    ...overrides,
  };
}

beforeEach(() => {
  document.body.dataset.page = "detail";
  window.history.replaceState({}, "", "/paper.html?paperId=paper-1");
  globalThis.fetch = vi.fn(async (input) => {
    const url = String(input);

    if (url.endsWith("/api/auth/me")) {
      return createJsonResponse({
        authenticated: true,
        user: {
          id: "user-1",
          username: "alice",
        },
      });
    }

    if (url.endsWith("/api/status")) {
      return createJsonResponse({ ok: true });
    }

    if (url.endsWith("/api/papers")) {
      return createJsonResponse([createPaper()]);
    }

    if (url.endsWith("/api/papers/paper-1")) {
      return createJsonResponse(createPaper());
    }

    if (url.endsWith("/api/papers/paper-1/annotations")) {
      return createJsonResponse([createAnnotation()]);
    }

    if (url.endsWith("/api/papers/paper-1/discussions")) {
      return createJsonResponse([createDiscussion()]);
    }

    if (url.endsWith("/api/papers/paper-1/content")) {
      return createJsonResponse({
        rawHtml: "<html><body><article><p>Alpha body paragraph.</p></article></body></html>",
      });
    }

    return createJsonResponse({});
  });
  resetClientStoreForTests();
});

afterEach(() => {
  cleanup();
  resetClientStoreForTests();
  vi.restoreAllMocks();
});

describe("detail page", () => {
  it("renders the loaded detail experience through React", async () => {
    render(<DetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Alpha paper")).toBeTruthy();
    });

    await waitFor(() => {
      expect(document.querySelector("#article-root")?.textContent).toContain("Alpha body paragraph.");
    });
    expect(document.querySelector("#annotation-list")?.textContent).toContain("Alpha annotation");
    expect(document.querySelector("#discussion-list")?.textContent).toContain("Alpha discussion");

    fireEvent.click(screen.getByRole("tab", { name: /讨论板/i }));

    await waitFor(() => {
      expect(document.querySelector("#discussion-board")?.classList.contains("is-hidden")).toBe(false);
    });
  });

  it("navigates back to the library index from the React detail page", async () => {
    const navigateSpy = vi.fn();
    setNavigationHandlerForTests(navigateSpy);

    render(<DetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Alpha paper")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "←返回文章和讨论列表" }));

    expect(navigateSpy).toHaveBeenCalledWith("./index.html");
  });
});
