// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getClientState,
  resetClientStoreForTests,
  setClientStateForTests,
} from "../shared/client-store";
import {
  clearSelectedPaperAnnotations,
  deleteSelectedDiscussion,
  initializeDetailPage,
  saveAnnotation,
  saveDetailEdit,
  saveDiscussionReply,
  selectPaper,
  setDetailComposerDraft,
  setDetailEditDraft,
  startDetailEdit,
} from "../detail/detail-store";

function createJsonResponse(body: any, init: { status?: number } = {}) {
  return {
    ok: init.status ? init.status < 400 : true,
    status: init.status ?? 200,
    json: async () => body,
  } as any;
}

function createDeferred() {
  let resolve: any;
  let reject: any;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, reject, resolve };
}

function createPaper(overrides = {}) {
  return {
    id: "paper-1",
    title: "Alpha paper",
    authors: "Alice",
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
    created_by_user_id: "user-1",
    created_by_username: "alice",
    attachments: [],
    ...overrides,
  };
}

beforeEach(() => {
  document.body.dataset.page = "detail";
  window.history.replaceState({}, "", "/paper.html");
  globalThis.fetch = vi.fn() as any;
  resetClientStoreForTests();
});

afterEach(() => {
  resetClientStoreForTests();
  vi.restoreAllMocks();
});

describe("detail client store", () => {
  it("initializes detail state from the route and falls back to the first paper", async () => {
    window.history.replaceState({}, "", "/paper.html?paperId=missing&panel=discussion");

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
        return createJsonResponse([
          createPaper(),
          createPaper({
            id: "paper-2",
            title: "Beta paper",
            sourceUrl: "https://example.org/papers/beta",
          }),
        ]);
      }

      if (url.endsWith("/api/papers/paper-1")) {
        return createJsonResponse(createPaper({ journal: "Nature" }));
      }

      if (url.endsWith("/api/papers/paper-1/annotations")) {
        return createJsonResponse([
          createAnnotation(),
          createAnnotation({
            id: "reply-1",
            parent_annotation_id: "annotation-1",
            root_annotation_id: "annotation-1",
            note: "Alpha reply",
            created_by_user_id: "user-2",
            created_by_username: "bob",
          }),
        ]);
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
    }) as any;

    await initializeDetailPage();

    expect(getClientState().detail.selectedPaperId).toBe("paper-1");
    expect(getClientState().detail.libraryPanel).toBe("discussion");
    expect(getClientState().detail.annotations).toHaveLength(2);
    expect(getClientState().detail.articleHtml).toContain("Alpha body paragraph");
  });

  it("restores deep-linked annotation and reply ids for the selected paper", async () => {
    window.history.replaceState(
      {},
      "",
      "/paper.html?paperId=paper-1&panel=reader&annotationId=annotation-1&replyId=reply-1"
    );

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
        return createJsonResponse([
          createAnnotation(),
          createAnnotation({
            id: "reply-1",
            parent_annotation_id: "annotation-1",
            root_annotation_id: "annotation-1",
            note: "Deep-linked reply",
            created_by_user_id: "user-2",
            created_by_username: "bob",
          }),
        ]);
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
    }) as any;

    await initializeDetailPage();

    expect(getClientState().detail.selectedAnnotationId).toBe("annotation-1");
    expect(getClientState().detail.selectedReplyId).toBe("reply-1");
    expect(getClientState().detail.annotationNavigationTargetId).toBe("annotation-1");
  });

  it("starts loading snapshot content in parallel when the list item already has snapshot metadata", async () => {
    const detailResponse = createDeferred();

    setClientStateForTests({
      auth: {
        currentUser: {
          id: "user-1",
          username: "alice",
        },
        serverReady: true,
      },
      papers: {
        items: [createPaper({ hasSnapshot: true, snapshotPath: "html/paper-1.html" })],
      },
    } as any);

    globalThis.fetch = vi.fn((input) => {
      const url = String(input);

      if (url.endsWith("/api/papers/paper-1")) {
        return detailResponse.promise;
      }

      if (url.endsWith("/api/papers/paper-1/annotations")) {
        return Promise.resolve(createJsonResponse([createAnnotation()]));
      }

      if (url.endsWith("/api/papers/paper-1/discussions")) {
        return Promise.resolve(createJsonResponse([createDiscussion()]));
      }

      if (url.endsWith("/api/papers/paper-1/content")) {
        return Promise.resolve(
          createJsonResponse({
            rawHtml: "<html><body><article><p>Parallel snapshot.</p></article></body></html>",
          })
        );
      }

      return Promise.resolve(createJsonResponse({}));
    }) as any;

    const selectionPromise = selectPaper("paper-1");
    await Promise.resolve();

    expect((globalThis.fetch as any).mock.calls.some(([input]: any) => String(input).endsWith("/api/papers/paper-1/content"))).toBe(
      true
    );

    detailResponse.resolve(createJsonResponse(createPaper({ journal: "Nature" })));
    await selectionPromise;

    expect(getClientState().detail.articleHtml).toContain("Parallel snapshot.");
  });

  it("falls back to a late snapshot content request when legacy list data omits snapshot metadata", async () => {
    const detailResponse = createDeferred();

    setClientStateForTests({
      auth: {
        currentUser: {
          id: "user-1",
          username: "alice",
        },
        serverReady: true,
      },
      papers: {
        items: [createPaper({ hasSnapshot: false, snapshotPath: "" })],
      },
    } as any);

    globalThis.fetch = vi.fn((input) => {
      const url = String(input);

      if (url.endsWith("/api/papers/paper-1")) {
        return detailResponse.promise;
      }

      if (url.endsWith("/api/papers/paper-1/annotations")) {
        return Promise.resolve(createJsonResponse([createAnnotation()]));
      }

      if (url.endsWith("/api/papers/paper-1/discussions")) {
        return Promise.resolve(createJsonResponse([createDiscussion()]));
      }

      if (url.endsWith("/api/papers/paper-1/content")) {
        return Promise.resolve(
          createJsonResponse({
            rawHtml: "<html><body><article><p>Fallback snapshot.</p></article></body></html>",
          })
        );
      }

      return Promise.resolve(createJsonResponse({}));
    }) as any;

    const selectionPromise = selectPaper("paper-1");
    await Promise.resolve();

    expect((globalThis.fetch as any).mock.calls.some(([input]: any) => String(input).endsWith("/api/papers/paper-1/content"))).toBe(
      false
    );

    detailResponse.resolve(
      createJsonResponse(createPaper({ hasSnapshot: true, snapshotPath: "html/paper-1.html" }))
    );
    await selectionPromise;

    expect((globalThis.fetch as any).mock.calls.filter(([input]: any) => String(input).endsWith("/api/papers/paper-1/content"))).toHaveLength(
      1
    );
    expect(getClientState().detail.articleHtml).toContain("Fallback snapshot.");
  });

  it("handles detail thread mutations through the shared store", async () => {
    const paper = createPaper();
    const discussion = createDiscussion();

    setClientStateForTests({
      auth: {
        currentUser: {
          id: "user-1",
          username: "alice",
        },
        serverReady: true,
      },
      papers: {
        items: [paper],
      },
      detail: {
        selectedPaperId: "paper-1",
        selectedPaper: paper,
        pendingSelection: {
          exact: "Alpha",
          prefix: "",
          suffix: " body",
          target_scope: "body",
          start_offset: 0,
          end_offset: 5,
        },
        selectedDiscussionId: "discussion-1",
        discussions: [discussion],
      },
    } as any);

    globalThis.fetch = vi.fn(async (input, init: any) => {
      const url = String(input);

      if (url.endsWith("/api/papers/paper-1/annotations") && init?.method === "POST") {
        return createJsonResponse(
          createAnnotation({
            note: "Saved annotation",
          })
        );
      }

      if (url.endsWith("/api/discussions/discussion-1/replies") && init?.method === "POST") {
        return createJsonResponse(
          createDiscussion({
            id: "discussion-reply-1",
            parent_discussion_id: "discussion-1",
            root_discussion_id: "discussion-1",
            note: "Saved discussion reply",
            created_by_user_id: "user-2",
            created_by_username: "bob",
          })
        );
      }

      if (url.endsWith("/api/discussions/discussion-1") && init?.method === "PATCH") {
        return createJsonResponse(
          createDiscussion({
            note: "Updated discussion note",
          })
        );
      }

      if (url.endsWith("/api/discussions/discussion-1") && init?.method === "DELETE") {
        return createJsonResponse({ ok: true });
      }

      if (url.endsWith("/api/papers/paper-1/annotations") && init?.method === "DELETE") {
        return createJsonResponse({ ok: true });
      }

      return createJsonResponse({});
    }) as any;

    setDetailComposerDraft("annotation", "Saved annotation");
    await saveAnnotation();

    expect(getClientState().detail.annotations).toHaveLength(1);
    expect(getClientState().detail.selectedAnnotationId).toBe("annotation-1");
    expect(getClientState().detail.pendingSelection).toBeNull();

    setDetailComposerDraft("discussionReply", "Saved discussion reply");
    await saveDiscussionReply();

    expect(getClientState().detail.discussions).toHaveLength(2);
    expect(getClientState().detail.selectedDiscussionReplyId).toBe("discussion-reply-1");

    startDetailEdit("discussion", "discussion-1", "discussion");
    setDetailEditDraft("discussion", "Updated discussion note");
    await saveDetailEdit("discussion");

    expect(getClientState().detail.discussions[0].note).toBe("Updated discussion note");

    await deleteSelectedDiscussion();
    expect(getClientState().detail.discussions).toHaveLength(0);

    await clearSelectedPaperAnnotations();
    expect(getClientState().detail.annotations).toHaveLength(0);
  });
});
