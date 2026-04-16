// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getClientState,
  initializeSession,
  refreshPapers,
  resetClientStoreForTests,
  setClientStateForTests,
  submitPaper,
} from "../shared/client-store.js";

function createJsonResponse(body, init = {}) {
  return {
    ok: init.status ? init.status < 400 : true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

beforeEach(() => {
  document.body.dataset.page = "catalog";
  globalThis.fetch = vi.fn();
  resetClientStoreForTests();
});

afterEach(() => {
  resetClientStoreForTests();
  vi.restoreAllMocks();
});

describe("client store", () => {
  it("recovers the authenticated session and refreshes the paper list", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url.endsWith("/api/auth/me")) {
        return createJsonResponse({
          authenticated: true,
          user: {
            id: "user-1",
            username: "alice",
            createdAt: "2026-04-16T00:00:00.000Z",
          },
        });
      }

      if (url.endsWith("/api/papers")) {
        return createJsonResponse([
          {
            id: "paper-1",
            title: "Older paper",
            createdAt: "2026-04-16T00:00:00.000Z",
            latestSpeechAt: "2026-04-16T00:30:00.000Z",
          },
          {
            id: "paper-2",
            title: "Newer paper",
            createdAt: "2026-04-16T00:00:00.000Z",
            latestSpeechAt: "2026-04-16T02:30:00.000Z",
          },
        ]);
      }

      return createJsonResponse({});
    });

    const authState = await initializeSession();
    const papers = await refreshPapers();

    expect(authState.authenticated).toBe(true);
    expect(getClientState().auth.currentUser?.username).toBe("alice");
    expect(getClientState().auth.databaseStatus).toBe("服务已连接");
    expect(papers.map((paper) => paper.id)).toEqual(["paper-2", "paper-1"]);
    expect(getClientState().papers.items.map((paper) => paper.id)).toEqual(["paper-2", "paper-1"]);
  });

  it("uses the HTML import endpoint when raw HTML is provided", async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
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
    });

    setClientStateForTests({
      auth: {
        isInitializing: false,
        serverReady: true,
        currentUser: {
          id: "user-1",
          username: "alice",
          createdAt: "2026-04-16T00:00:00.000Z",
        },
      },
    });

    const savedPaper = await submitPaper({
      sourceUrl: "https://example.org/paper",
      rawHtml: "<html><body>snapshot</body></html>",
    });

    expect(savedPaper.id).toBe("paper-3");
    expect(getClientState().catalog.paperFormStatus).toBe("源码导入成功，已写入 storage");
    expect(getClientState().papers.items.map((paper) => paper.id)).toEqual(["paper-3"]);
  });
});
