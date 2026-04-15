import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createServices } = require("../src/server/services");

function createDeps(overrides = {}) {
  class TestHttpError extends Error {
    constructor(statusCode, message) {
      super(message);
      this.statusCode = statusCode;
    }
  }

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
    normalizeMimeType: vi.fn((value) => String(value).trim().toLowerCase()),
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
    expect(await services.dashboard.getForUser({ id: "user-1" })).toEqual({
      uploadedPapers: [],
    });
    expect(await services.papers.fetchAndStore("https://example.org/paper-1", { id: "user-1" })).toEqual({
      id: "paper-1",
    });
    expect(await services.speech.getAnnotationsByUserId({ id: "user-1" })).toEqual([
      { id: "annotation-2" },
    ]);
    expect(await services.speech.saveDiscussion("paper-1", { note: "hello" }, { id: "user-1" })).toEqual({
      id: "discussion-1",
    });

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
    expect(deps.getUserDashboard).toHaveBeenCalledWith({ id: "user-1" });
    expect(deps.fetchAndStorePaper).toHaveBeenCalledWith("https://example.org/paper-1", { id: "user-1" });
    expect(deps.getAnnotationsByUserId).toHaveBeenCalledWith({ id: "user-1" });
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
