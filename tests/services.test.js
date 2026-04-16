import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createServices } = require("../src/server/services");

function createDashboardFixture() {
  const paper = {
    id: "paper-1",
    sourceUrl: "https://example.org/paper-1",
    title: "Stored Paper",
    published: "2026",
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
    fetchedAt: "2026-04-15T00:00:00.000Z",
    speechCount: 4,
    latestSpeechAt: "2026-04-15T00:04:00.000Z",
    latestSpeakerUsername: "member1",
    created_by_user_id: "user-1",
    created_by_username: "admin",
  };
  const ownedAnnotation = {
    id: "annotation-owned",
    paperId: "paper-1",
    note: "Admin annotation",
    exact: "Admin",
    prefix: "",
    suffix: "",
    target_scope: "body",
    start_offset: 0,
    end_offset: 5,
    created_by_user_id: "user-1",
    created_by_username: "admin",
    created_at: "2026-04-15T00:01:00.000Z",
    parent_annotation_id: "",
    root_annotation_id: "annotation-owned",
    attachments: [],
  };
  const replyAnnotation = {
    id: "annotation-reply",
    paperId: "paper-1",
    note: "Member reply",
    exact: "Admin",
    prefix: "",
    suffix: "",
    target_scope: "body",
    start_offset: 0,
    end_offset: 5,
    created_by_user_id: "user-2",
    created_by_username: "member1",
    created_at: "2026-04-15T00:02:00.000Z",
    parent_annotation_id: "annotation-owned",
    root_annotation_id: "annotation-owned",
    attachments: [],
  };
  const ownedDiscussion = {
    id: "discussion-owned",
    paperId: "paper-1",
    note: "Admin discussion",
    created_by_user_id: "user-1",
    created_by_username: "admin",
    created_at: "2026-04-15T00:03:00.000Z",
    parent_discussion_id: "",
    root_discussion_id: "discussion-owned",
    attachments: [],
  };
  const replyDiscussion = {
    id: "discussion-reply",
    paperId: "paper-1",
    note: "Member discussion reply",
    created_by_user_id: "user-2",
    created_by_username: "member1",
    created_at: "2026-04-15T00:04:00.000Z",
    parent_discussion_id: "discussion-owned",
    root_discussion_id: "discussion-owned",
    attachments: [],
  };

  return {
    ownedAnnotation,
    ownedDiscussion,
    paper,
    replyAnnotation,
    replyDiscussion,
  };
}

function createDeps(overrides = {}) {
  class TestHttpError extends Error {
    constructor(statusCode, message) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  const dashboardFixture = createDashboardFixture();
  const database = {
    prepare: vi.fn((query) => {
      const normalizedQuery = String(query || "").replace(/\s+/g, " ").trim();

      if (normalizedQuery.includes("FROM annotations child")) {
        return {
          all: vi.fn(() => [{ json: JSON.stringify(dashboardFixture.replyAnnotation) }]),
        };
      }

      if (normalizedQuery.includes("FROM discussions child")) {
        return {
          all: vi.fn(() => [{ json: JSON.stringify(dashboardFixture.replyDiscussion) }]),
        };
      }

      if (
        normalizedQuery.includes("FROM papers") &&
        normalizedQuery.includes("GROUP BY created_by_user_id") &&
        !normalizedQuery.includes("UNION ALL")
      ) {
        return {
          all: vi.fn(() => [{ lookup_key: "user-1", count: 1 }]),
        };
      }

      if (normalizedQuery.includes("UNION ALL")) {
        return {
          all: vi.fn(() => [
            { lookup_key: "user-1", count: 2 },
            { lookup_key: "user-2", count: 2 },
          ]),
        };
      }

      throw new Error(`Unexpected dashboard query: ${normalizedQuery}`);
    }),
  };
  const store = {
    getDatabase: vi.fn(() => database),
    annotations: {
      listByIds: vi.fn(() => [dashboardFixture.ownedAnnotation, dashboardFixture.replyAnnotation]),
      listByUserId: vi.fn(() => [dashboardFixture.ownedAnnotation]),
    },
    discussions: {
      listByIds: vi.fn(() => [dashboardFixture.ownedDiscussion, dashboardFixture.replyDiscussion]),
      listByUserId: vi.fn(() => [dashboardFixture.ownedDiscussion]),
    },
    papers: {
      listByIds: vi.fn(() => [dashboardFixture.paper]),
      listByUserId: vi.fn(() => [dashboardFixture.paper]),
    },
    users: {
      getById: vi.fn((userId) =>
        userId === "user-1"
          ? {
              id: "user-1",
              username: "admin",
              role: "admin",
              createdAt: "2026-04-15T00:00:00.000Z",
            }
          : null
      ),
      listAll: vi.fn(() => [
        {
          id: "user-1",
          username: "admin",
          role: "admin",
          createdAt: "2026-04-15T00:00:00.000Z",
        },
        {
          id: "user-2",
          username: "member1",
          role: "member",
          createdAt: "2026-04-15T00:00:00.000Z",
        },
      ]),
    },
  };

  return {
    ANNOTATIONS_FILE: "/tmp/annotations.json",
    DISCUSSIONS_FILE: "/tmp/discussions.json",
    PAPERS_FILE: "/tmp/papers.json",
    PORT: 3000,
    STORAGE_DIR: "/tmp/storage",
    HttpError: TestHttpError,
    applyCorsHeaders: vi.fn(),
    assertAdminUser: vi.fn(),
    changeUserPassword: vi.fn().mockResolvedValue(undefined),
    changeUsername: vi.fn().mockResolvedValue({ id: "user-1", username: "renamed" }),
    clearAnnotationsByPaperId: vi.fn().mockResolvedValue(3),
    createMemberUser: vi.fn().mockResolvedValue({ id: "user-2", username: "member" }),
    deleteAnnotationById: vi.fn().mockResolvedValue({ ok: true }),
    deleteDiscussionById: vi.fn().mockResolvedValue({ ok: true }),
    deletePaperById: vi.fn().mockResolvedValue({ ok: true }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    deleteUserById: vi.fn().mockResolvedValue({ deletedUserId: "user-2" }),
    enforceSnapshotArticleImagePolicy: vi.fn((html) => `${html}\n<!-- sanitized -->`),
    ensureStorageFiles: vi.fn().mockResolvedValue(undefined),
    fetchAndStorePaper: vi.fn().mockResolvedValue({ id: "paper-1" }),
    fetchElsevierObjectBinary: vi.fn().mockResolvedValue({
      contentType: "text/plain",
      content: Buffer.from("asset"),
    }),
    fs: {
      readFile: vi.fn().mockResolvedValue("<article>snapshot</article>"),
    },
    getAnnotationsByPaperId: vi.fn().mockResolvedValue([{ id: "annotation-1" }]),
    getAnnotationsByUserId: vi.fn().mockResolvedValue([{ id: "annotation-2" }]),
    getCurrentUserFromRequest: vi.fn().mockResolvedValue({ id: "user-1" }),
    getDiscussionsByPaperId: vi.fn().mockResolvedValue([{ id: "discussion-1" }]),
    getJsonCollectionLength: vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3),
    getPaperById: vi.fn().mockResolvedValue({
      id: "paper-1",
      snapshotPath: "html/paper-1.html",
      sourceUrl: "https://example.org/paper-1",
    }),
    getPublicUserProfile: vi.fn().mockResolvedValue({ id: "user-1", username: "admin" }),
    getSessionTokenFromRequest: vi.fn().mockReturnValue("session-1"),
    getUserDashboard: vi.fn().mockResolvedValue({ uploadedPapers: [] }),
    importPaperFromHtml: vi.fn().mockResolvedValue({ id: "paper-2" }),
    listPapersWithActivity: vi.fn().mockResolvedValue([{ id: "paper-1", speechCount: 2 }]),
    listUsersWithStats: vi.fn().mockResolvedValue([{ id: "user-1", username: "admin" }]),
    loginUser: vi.fn().mockResolvedValue({ token: "session-1", user: { id: "user-1" } }),
    normalizeAnnotationRecord: vi.fn((value) => value),
    normalizeDiscussionRecord: vi.fn((value) => value),
    normalizeMimeType: vi.fn((value) => String(value).trim().toLowerCase()),
    normalizePaperRecord: vi.fn((value) => value),
    path,
    readRequestJson: vi.fn().mockResolvedValue({ sourceUrl: "https://example.org" }),
    readSpeechMutationBody: vi.fn().mockResolvedValue({ note: "hello" }),
    saveAnnotation: vi.fn().mockResolvedValue({ id: "annotation-1" }),
    saveAnnotationReply: vi.fn().mockResolvedValue({ id: "annotation-2" }),
    saveDiscussion: vi.fn().mockResolvedValue({ id: "discussion-1" }),
    saveDiscussionReply: vi.fn().mockResolvedValue({ id: "discussion-2" }),
    sendJson: vi.fn(),
    serializeExpiredSessionCookie: vi.fn().mockReturnValue("expired-cookie"),
    serializeSessionCookie: vi.fn().mockReturnValue("session-cookie"),
    serializeUser: vi.fn((user) => ({ ...user, safe: true })),
    servePrivateStorageAsset: vi.fn().mockResolvedValue(undefined),
    serveStaticAsset: vi.fn().mockResolvedValue(undefined),
    store,
    transferAdminRole: vi.fn().mockResolvedValue({ currentUser: {}, targetUser: {} }),
    updateAnnotationById: vi.fn().mockResolvedValue({ id: "annotation-1", note: "updated" }),
    updateDiscussionById: vi.fn().mockResolvedValue({ id: "discussion-1", note: "updated" }),
    ...overrides,
  };
}

describe("services container", () => {
  it("groups domain services and preserves delegated behavior", async () => {
    const deps = createDeps();
    const services = createServices(deps);

    expect(services.runtime.PORT).toBe(3000);
    expect(await services.auth.login({ username: "admin" })).toEqual({
      token: "session-1",
      user: { id: "user-1" },
    });
    expect(await services.users.changeUsername("user-1", { username: "renamed" })).toEqual({
      id: "user-1",
      username: "renamed",
    });
    const dashboard = await services.dashboard.getForUser({ id: "user-1" });
    expect(dashboard.uploadedPapers).toHaveLength(1);
    expect(dashboard.myAnnotations).toHaveLength(2);
    expect(dashboard.repliesToMyAnnotations).toHaveLength(2);
    expect(dashboard.repliesToMyAnnotations[0].id).toBe("discussion-reply");
    expect(await services.papers.fetchAndStore("https://example.org/paper-1", { id: "user-1" })).toEqual({
      id: "paper-1",
    });
    expect(await services.speech.getAnnotationsByUserId({ id: "user-1" })).toEqual([
      expect.objectContaining({ id: "discussion-owned" }),
      expect.objectContaining({ id: "annotation-owned" }),
    ]);
    expect(await services.speech.saveDiscussion("paper-1", { note: "hello" }, { id: "user-1" })).toEqual({
      id: "discussion-1",
    });
    const profile = await services.dashboard.getPublicUserProfile("user-1");
    expect(profile.user).toEqual(expect.objectContaining({ id: "user-1", username: "admin", safe: true }));
    expect(profile.uploadedPapers).toEqual([expect.objectContaining({ id: "paper-1" })]);
    expect(profile.annotations).toHaveLength(2);
    expect(profile.annotations[0]).toEqual(expect.objectContaining({ id: "discussion-owned" }));
    await expect(services.dashboard.listUsersWithStats()).resolves.toEqual([
      expect.objectContaining({
        id: "user-1",
        username: "admin",
        uploadedPaperCount: 1,
        annotationCount: 2,
      }),
      expect.objectContaining({
        id: "user-2",
        username: "member1",
        uploadedPaperCount: 0,
        annotationCount: 2,
      }),
    ]);

    const snapshot = await services.papers.readSnapshotContent("paper-1");
    expect(snapshot).toEqual({
      rawHtml: "<article>snapshot</article>\n<!-- sanitized -->",
    });

    const stats = await services.system.getCollectionStats();
    expect(stats).toEqual({
      paperCount: 1,
      annotationCount: 2,
      discussionCount: 3,
    });

    const asset = await services.assets.fetchElsevierObject("EID-1", " TEXT/PLAIN ");
    expect(asset.contentType).toBe("text/plain");
    expect(asset.content.toString("utf8")).toBe("asset");

    expect(deps.loginUser).toHaveBeenCalledWith({ username: "admin" });
    expect(deps.changeUsername).toHaveBeenCalledWith("user-1", { username: "renamed" });
    expect(deps.fetchAndStorePaper).toHaveBeenCalledWith("https://example.org/paper-1", { id: "user-1" });
    expect(deps.getAnnotationsByUserId).not.toHaveBeenCalled();
    expect(deps.saveDiscussion).toHaveBeenCalledWith("paper-1", { note: "hello" }, { id: "user-1" });
    expect(deps.fs.readFile).toHaveBeenCalledWith("/tmp/storage/html/paper-1.html", "utf8");
    expect(deps.enforceSnapshotArticleImagePolicy).toHaveBeenCalledWith(
      "<article>snapshot</article>",
      "https://example.org/paper-1"
    );
    expect(deps.getJsonCollectionLength).toHaveBeenNthCalledWith(1, "/tmp/papers.json");
    expect(deps.getJsonCollectionLength).toHaveBeenNthCalledWith(2, "/tmp/annotations.json");
    expect(deps.getJsonCollectionLength).toHaveBeenNthCalledWith(3, "/tmp/discussions.json");
    expect(deps.normalizeMimeType).toHaveBeenCalledWith(" TEXT/PLAIN ");
    expect(deps.store.papers.listByUserId).toHaveBeenCalledWith("user-1");
    expect(deps.store.annotations.listByUserId).toHaveBeenCalledWith("user-1");
    expect(deps.store.discussions.listByUserId).toHaveBeenCalledWith("user-1");
    expect(deps.fetchElsevierObjectBinary).toHaveBeenCalledWith("EID-1", "text/plain");
  });

  it("raises stable 404s when a paper snapshot cannot be read", async () => {
    const missingPaperDeps = createDeps({
      getPaperById: vi.fn().mockResolvedValue(null),
    });
    const missingPaperServices = createServices(missingPaperDeps);

    await expect(missingPaperServices.papers.readSnapshotContent("paper-missing")).rejects.toMatchObject({
      message: "文献不存在",
      statusCode: 404,
    });

    const missingSnapshotDeps = createDeps({
      getPaperById: vi.fn().mockResolvedValue({
        id: "paper-2",
        snapshotPath: "",
        sourceUrl: "https://example.org/paper-2",
      }),
    });
    const missingSnapshotServices = createServices(missingSnapshotDeps);

    await expect(missingSnapshotServices.papers.readSnapshotContent("paper-2")).rejects.toMatchObject({
      message: "当前文献没有网页快照",
      statusCode: 404,
    });
  });
});
