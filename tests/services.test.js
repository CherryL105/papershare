import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createAssetsService } = require("../src/server/services/assets-service");
const { createAuthService } = require("../src/server/services/auth-service");
const { createServices } = require("../src/server/services");
const { createUsersService } = require("../src/server/services/users-service");

afterEach(() => {
  delete process.env.ELSEVIER_API_KEY;
  delete process.env.PAPERSHARE_BOOTSTRAP_ADMIN_PASSWORD;
  vi.restoreAllMocks();
});

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
    snapshotPath: "html/paper-1.html",
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

function createContainerDeps(overrides = {}) {
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
    annotations: {
      deleteById: vi.fn(),
      deleteByIds: vi.fn(),
      deleteByPaperId: vi.fn(),
      getById: vi.fn(),
      insert: vi.fn(),
      listByIds: vi.fn(() => [dashboardFixture.ownedAnnotation, dashboardFixture.replyAnnotation]),
      listByPaperId: vi.fn(() => [dashboardFixture.ownedAnnotation, dashboardFixture.replyAnnotation]),
      listByRootId: vi.fn(() => []),
      listByUser: vi.fn(() => []),
      listByUserId: vi.fn(() => [dashboardFixture.ownedAnnotation]),
      reparentChildren: vi.fn(),
      update: vi.fn((annotation) => annotation),
    },
    discussions: {
      deleteById: vi.fn(),
      deleteByIds: vi.fn(),
      deleteByPaperId: vi.fn(),
      getById: vi.fn(),
      insert: vi.fn(),
      listByIds: vi.fn(() => [dashboardFixture.ownedDiscussion, dashboardFixture.replyDiscussion]),
      listByPaperId: vi.fn(() => [dashboardFixture.ownedDiscussion, dashboardFixture.replyDiscussion]),
      listByRootId: vi.fn(() => []),
      listByUser: vi.fn(() => []),
      listByUserId: vi.fn(() => [dashboardFixture.ownedDiscussion]),
      reparentChildren: vi.fn(),
      update: vi.fn((discussion) => discussion),
    },
    getCollectionLength: vi.fn(async (filePath) => {
      if (filePath === "/tmp/papers.json") {
        return 1;
      }

      if (filePath === "/tmp/annotations.json") {
        return 2;
      }

      if (filePath === "/tmp/discussions.json") {
        return 3;
      }

      return 0;
    }),
    getDatabase: vi.fn(() => database),
    papers: {
      backfillActivityFields: vi.fn(),
      deleteByIds: vi.fn(),
      getById: vi.fn((paperId) => (paperId === "paper-1" ? dashboardFixture.paper : null)),
      getBySourceUrl: vi.fn(() => null),
      insert: vi.fn((paper) => paper),
      listByIds: vi.fn(() => [dashboardFixture.paper]),
      listByUser: vi.fn(() => []),
      listByUserId: vi.fn(() => [dashboardFixture.paper]),
      listWithActivity: vi.fn(() => [dashboardFixture.paper]),
      refreshActivitiesByIds: vi.fn(),
      update: vi.fn((paper) => paper),
    },
    runInTransaction: vi.fn((action) =>
      action({
        annotations: store.annotations,
        discussions: store.discussions,
        papers: store.papers,
        sessions: store.sessions,
        users: store.users,
      })
    ),
    sessions: {
      deleteByToken: vi.fn(),
      deleteByUserId: vi.fn(),
      getByToken: vi.fn(() => null),
      replaceSessionForUser: vi.fn(),
    },
    users: {
      deleteById: vi.fn(),
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
      getByUsername: vi.fn(() => null),
      insert: vi.fn(),
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
      update: vi.fn((user) => user),
    },
  };

  return {
    ANNOTATIONS_FILE: "/tmp/annotations.json",
    ATTACHMENTS_DIR: "/tmp/storage/attachments",
    CLIENT_DIST_DIR: "/tmp/dist",
    DISCUSSIONS_FILE: "/tmp/discussions.json",
    HTML_DIR: "/tmp/storage/html",
    MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
    MAX_ATTACHMENT_COUNT: 6,
    MAX_TOTAL_ATTACHMENT_BYTES: 20 * 1024 * 1024,
    MIME_TYPE_BY_EXTENSION: {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".png": "image/png",
    },
    PAPERS_FILE: "/tmp/papers.json",
    PORT: 3000,
    SESSION_COOKIE_NAME: "papershare_session",
    STORAGE_DIR: "/tmp/storage",
    STATIC_ASSET_CACHE_CONTROL: "public, max-age=300, must-revalidate",
    STATIC_HASHED_ASSET_CACHE_CONTROL: "public, max-age=31536000, immutable",
    STATIC_HTML_CACHE_CONTROL: "no-cache",
    HttpError: TestHttpError,
    applyCorsHeaders: vi.fn(),
    createAnnotationId: vi.fn(() => "annotation-created"),
    createAttachmentId: vi.fn(() => "attachment-created"),
    createDiscussionId: vi.fn(() => "discussion-created"),
    createPaperId: vi.fn(() => "paper-created"),
    enforceSnapshotArticleImagePolicy: vi.fn((html) => `${html}\n<!-- sanitized -->`),
    fs: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue("<article>snapshot</article>"),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn().mockResolvedValue({
        isFile: () => true,
        mtime: new Date("2026-04-15T00:00:00.000Z"),
        mtimeMs: new Date("2026-04-15T00:00:00.000Z").getTime(),
        size: 24,
      }),
      unlink: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
    formatLimitInMb: vi.fn((value) => Math.round((value / (1024 * 1024)) * 10) / 10),
    normalizeAnnotationRecord: vi.fn((value) => value),
    normalizeAttachmentRecord: vi.fn((value) => ({
      ...value,
      storage_path: String(value?.storage_path || "").trim(),
      url: value?.storage_path ? `/api/storage/${value.storage_path}` : value?.url || "",
    })),
    normalizeAttachmentRecords: vi.fn((attachments) => (Array.isArray(attachments) ? attachments : [])),
    normalizeDiscussionRecord: vi.fn((value) => value),
    normalizePaperRecord: vi.fn((value) => value),
    normalizeStorageRecordPath: vi.fn((storagePath) =>
      String(storagePath || "")
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\/+/, "")
    ),
    path,
    readRequestJson: vi.fn().mockResolvedValue({ sourceUrl: "https://example.org" }),
    readSpeechMutationBody: vi.fn().mockResolvedValue({ note: "hello" }),
    resolveAttachmentDescriptor: vi.fn((originalName, mimeType) => ({
      category: String(mimeType || "").includes("image/") ? "image" : "table",
      extension: path.extname(originalName) || ".csv",
      mimeType: String(mimeType || "").trim().toLowerCase() || "text/csv",
    })),
    resolveStorageAbsolutePath: vi.fn((storagePath) => path.join("/tmp/storage", storagePath)),
    sanitizeAttachmentName: vi.fn((value) =>
      String(value || "")
        .trim()
        .replace(/^.*[\\/]/, "")
        .replace(/[^\w.\-()\u4e00-\u9fa5 ]+/g, "_")
        .slice(0, 120)
    ),
    sendJson: vi.fn(),
    store,
    ...overrides,
  };
}

function createLegacyPasswordHash(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function createAuthStoreFixture() {
  const users = [
    {
      id: "user-1",
      username: "admin",
      role: "admin",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
      mustChangePassword: false,
      passwordHash: createLegacyPasswordHash("admin-pass"),
    },
  ];
  const sessions = [];
  const store = {
    runInTransaction: vi.fn((action) =>
      action({
        sessions: store.sessions,
        users: store.users,
      })
    ),
    sessions: {
      deleteByToken: vi.fn((token) => {
        const index = sessions.findIndex((session) => session.token === token);

        if (index >= 0) {
          sessions.splice(index, 1);
        }
      }),
      getByToken: vi.fn((token) => sessions.find((session) => session.token === token) || null),
      replaceSessionForUser: vi.fn((session) => {
        const normalizedSession = {
          ...session,
        };
        const existingIndex = sessions.findIndex((item) => item.userId === normalizedSession.userId);

        if (existingIndex >= 0) {
          sessions.splice(existingIndex, 1, normalizedSession);
        } else {
          sessions.push(normalizedSession);
        }

        return normalizedSession;
      }),
    },
    users: {
      getById: vi.fn((userId) => users.find((user) => user.id === userId) || null),
      getByUsername: vi.fn((username) => users.find((user) => user.username === username) || null),
      update: vi.fn((nextUser) => {
        const index = users.findIndex((user) => user.id === nextUser.id);
        users.splice(index, 1, { ...nextUser });
        return nextUser;
      }),
    },
  };

  return { sessions, store, users };
}

function createResponseRecorder() {
  const chunks = [];

  return {
    body: Buffer.alloc(0),
    headers: {},
    statusCode: 0,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...headers };
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk) {
      if (chunk !== undefined) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }

      this.body = Buffer.concat(chunks);
    },
  };
}

describe("services container", () => {
  it("groups dashboard, papers, speech, system, and asset proxy behavior", async () => {
    const deps = createContainerDeps();
    const services = createServices(deps);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          '<!doctype html><html><head><title>Fetched Paper</title><meta name="citation_title" content="Fetched Paper" /></head><body><article><p>Body</p></article></body></html>',
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(Buffer.from("asset"), {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      );

    expect(services.runtime.PORT).toBe(3000);

    const dashboard = await services.dashboard.getForUser({ id: "user-1" });
    expect(dashboard.uploadedPapers).toHaveLength(1);
    expect(dashboard.myAnnotations).toHaveLength(2);
    expect(dashboard.repliesToMyAnnotations).toHaveLength(2);
    expect(dashboard.repliesToMyAnnotations[0].id).toBe("discussion-reply");

    expect(
      await services.papers.fetchAndStore("https://example.org/paper-1", {
        id: "user-1",
        username: "admin",
      })
    ).toEqual(
      expect.objectContaining({
        id: "paper-created",
        sourceUrl: "https://example.org/paper-1",
        title: "Fetched Paper",
      })
    );

    expect(await services.speech.getAnnotationsByUserId({ id: "user-1" })).toEqual([
      expect.objectContaining({ id: "discussion-owned" }),
      expect.objectContaining({ id: "annotation-owned" }),
    ]);

    expect(
      await services.speech.saveDiscussion("paper-1", { note: "hello" }, { id: "user-1", username: "admin" })
    ).toEqual(
      expect.objectContaining({
        id: "discussion-created",
        note: "hello",
      })
    );

    const profile = await services.dashboard.getPublicUserProfile("user-1");
    expect(profile.user).toEqual(
      expect.objectContaining({ createdAt: "2026-04-15T00:00:00.000Z", id: "user-1", username: "admin" })
    );
    expect(profile.uploadedPapers).toEqual([expect.objectContaining({ id: "paper-1" })]);
    expect(profile.annotations).toHaveLength(2);

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

    process.env.ELSEVIER_API_KEY = "test-api-key";
    const asset = await services.assets.fetchElsevierObject("EID-1", " image/png ");
    expect(asset.contentType).toBe("image/png");
    expect(asset.content.toString("utf8")).toBe("asset");

    expect(deps.store.papers.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "paper-created",
        title: "Fetched Paper",
      })
    );
    expect(deps.store.discussions.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "discussion-created",
        note: "hello",
      })
    );
    expect(deps.fs.readFile).toHaveBeenCalledWith("/tmp/storage/html/paper-1.html", "utf8");
    expect(deps.enforceSnapshotArticleImagePolicy).toHaveBeenCalledWith(
      "<article>snapshot</article>",
      "https://example.org/paper-1"
    );
    expect(deps.store.getCollectionLength).toHaveBeenNthCalledWith(1, "/tmp/papers.json");
    expect(deps.store.getCollectionLength).toHaveBeenNthCalledWith(2, "/tmp/annotations.json");
    expect(deps.store.getCollectionLength).toHaveBeenNthCalledWith(3, "/tmp/discussions.json");
    expect(deps.store.papers.listByUserId).toHaveBeenCalledWith("user-1");
    expect(deps.store.annotations.listByUserId).toHaveBeenCalledWith("user-1");
    expect(deps.store.discussions.listByUserId).toHaveBeenCalledWith("user-1");
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.org/paper-1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/content/object/eid/EID-1");
  });

  it("caches dashboard reads and invalidates them after speech writes", async () => {
    const deps = createContainerDeps();
    const services = createServices(deps);

    await services.dashboard.getForUser({ id: "user-1" });
    await services.dashboard.getForUser({ id: "user-1" });

    expect(deps.store.papers.listByUserId).toHaveBeenCalledTimes(1);
    expect(deps.store.annotations.listByUserId).toHaveBeenCalledTimes(1);
    expect(deps.store.discussions.listByUserId).toHaveBeenCalledTimes(1);

    await services.speech.saveDiscussion("paper-1", { note: "cache bust" }, { id: "user-1", username: "admin" });
    await services.dashboard.getForUser({ id: "user-1" });

    expect(deps.store.papers.listByUserId).toHaveBeenCalledTimes(2);
    expect(deps.store.annotations.listByUserId).toHaveBeenCalledTimes(2);
    expect(deps.store.discussions.listByUserId).toHaveBeenCalledTimes(2);

    await services.dashboard.listUsersWithStats();
    await services.dashboard.listUsersWithStats();
    expect(deps.store.getDatabase).toHaveBeenCalledTimes(3);
  });

  it("raises stable 404s when a paper snapshot cannot be read", async () => {
    const missingPaperDeps = createContainerDeps();
    missingPaperDeps.store.papers.getById = vi.fn(() => null);
    const missingPaperServices = createServices(missingPaperDeps);

    await expect(missingPaperServices.papers.readSnapshotContent("paper-missing")).rejects.toMatchObject({
      message: "文献不存在",
      statusCode: 404,
    });

    const missingSnapshotDeps = createContainerDeps();
    missingSnapshotDeps.store.papers.getById = vi.fn(() => ({
      id: "paper-2",
      snapshotPath: "",
      sourceUrl: "https://example.org/paper-2",
    }));
    const missingSnapshotServices = createServices(missingSnapshotDeps);

    await expect(missingSnapshotServices.papers.readSnapshotContent("paper-2")).rejects.toMatchObject({
      message: "当前文献没有网页快照",
      statusCode: 404,
    });
  });

  it("uses the injected attachment sanitizer when persisting speech attachments", async () => {
    const deps = createContainerDeps({
      sanitizeAttachmentName: vi.fn(() => "sanitized name.csv"),
    });
    const services = createServices(deps);

    const savedDiscussion = await services.speech.saveDiscussion(
      "paper-1",
      {
        note: "hello",
        attachments: [
          {
            name: " ../unsafe?.csv ",
            contentBase64: Buffer.from("col1,col2\n1,2\n", "utf8").toString("base64"),
          },
        ],
      },
      { id: "user-1", username: "admin" }
    );

    expect(deps.sanitizeAttachmentName).toHaveBeenCalledWith(" ../unsafe?.csv ");
    expect(savedDiscussion.attachments).toEqual([
      expect.objectContaining({
        original_name: "sanitized name.csv",
      }),
    ]);
  });

  it("keeps attachment count and size validation on the lowercase speech-service deps", async () => {
    const deps = createContainerDeps({
      MAX_ATTACHMENT_BYTES: 4,
      MAX_ATTACHMENT_COUNT: 1,
      MAX_TOTAL_ATTACHMENT_BYTES: 4,
    });
    const services = createServices(deps);
    const currentUser = { id: "user-1", username: "admin" };

    await expect(
      services.speech.saveDiscussion(
        "paper-1",
        {
          note: "too many",
          attachments: [
            {
              name: "first.csv",
              contentBase64: Buffer.from("1", "utf8").toString("base64"),
            },
            {
              name: "second.csv",
              contentBase64: Buffer.from("2", "utf8").toString("base64"),
            },
          ],
        },
        currentUser
      )
    ).rejects.toThrow("单次最多上传 1 个附件");

    await expect(
      services.speech.saveDiscussion(
        "paper-1",
        {
          note: "too large",
          attachments: [
            {
              name: "large.csv",
              contentBase64: Buffer.from("12345", "utf8").toString("base64"),
            },
          ],
        },
        currentUser
      )
    ).rejects.toThrow("附件“large.csv”超过 0 MB 限制");
  });
});

describe("auth service", () => {
  it("logs in legacy users, rehashes passwords, and resolves bearer/cookie sessions", async () => {
    const { sessions, store, users } = createAuthStoreFixture();
    const auth = createAuthService({
      sessionCookieName: "papershare_session",
      store,
    });

    const session = await auth.login({
      password: "admin-pass",
      username: "admin",
    });

    expect(session.user).toEqual(
      expect.objectContaining({
        id: "user-1",
        mustChangePassword: false,
        role: "admin",
        username: "admin",
      })
    );
    expect(store.users.update).toHaveBeenCalledTimes(1);
    expect(users[0].passwordHash.startsWith("scrypt$")).toBe(true);
    expect(sessions).toHaveLength(1);

    const bearerUser = await auth.getCurrentUserFromRequest({
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    });
    expect(bearerUser?.id).toBe("user-1");

    const cookieUser = await auth.getCurrentUserFromRequest({
      headers: {
        cookie: `papershare_session=${encodeURIComponent(session.token)}`,
      },
      socket: {
        encrypted: true,
      },
    });
    expect(cookieUser?.id).toBe("user-1");

    expect(
      auth.serializeSessionCookie(
        {
          headers: {
            "x-forwarded-proto": "https",
          },
          socket: {},
        },
        session.token
      )
    ).toContain("Secure");
    expect(auth.serializeExpiredSessionCookie({ headers: {}, socket: {} })).toContain("Max-Age=0");

    await auth.deleteSession(session.token);
    expect(await auth.getCurrentUserFromRequest({ headers: {} })).toBeNull();
  });
});

describe("users service", () => {
  it("updates passwords, syncs renamed usernames, transfers admin, and invalidates dashboard caches", async () => {
    class TestHttpError extends Error {
      constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
      }
    }

    const users = [
      {
        id: "user-1",
        username: "admin",
        role: "admin",
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z",
        mustChangePassword: false,
        passwordHash: "admin-hash",
      },
      {
        id: "user-2",
        username: "member1",
        role: "member",
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z",
        mustChangePassword: true,
        passwordHash: "member-hash",
      },
    ];
    const ownedPaper = {
      id: "paper-1",
      title: "Owned Paper",
      created_by_user_id: "user-2",
      created_by_username: "member1",
      paperId: "paper-1",
    };
    const ownedAnnotation = {
      id: "annotation-1",
      attachments: [],
      created_by_user_id: "user-2",
      created_by_username: "member1",
      paperId: "paper-1",
      parent_annotation_id: "",
      root_annotation_id: "annotation-1",
    };
    const ownedDiscussion = {
      id: "discussion-1",
      attachments: [],
      created_by_user_id: "user-2",
      created_by_username: "member1",
      paperId: "paper-1",
      parent_discussion_id: "",
      root_discussion_id: "discussion-1",
    };
    const usersRepo = {
      deleteById: vi.fn(),
      getById: vi.fn((userId) => users.find((user) => user.id === userId) || null),
      insert: vi.fn((user) => {
        users.push({ ...user });
        return user;
      }),
      listAll: vi.fn(() => users.map((user) => ({ ...user }))),
      update: vi.fn((nextUser) => {
        const index = users.findIndex((user) => user.id === nextUser.id);
        users.splice(index, 1, { ...nextUser });
        return nextUser;
      }),
    };
    const store = {
      annotations: {
        deleteById: vi.fn(),
        deleteByIds: vi.fn(),
        deleteByPaperId: vi.fn(),
        getById: vi.fn(() => null),
        listByPaperId: vi.fn(() => []),
        listByRootId: vi.fn(() => []),
        listByUser: vi.fn(() => [ownedAnnotation]),
        reparentChildren: vi.fn(),
        update: vi.fn((value) => value),
      },
      discussions: {
        deleteById: vi.fn(),
        deleteByIds: vi.fn(),
        deleteByPaperId: vi.fn(),
        getById: vi.fn(() => null),
        listByPaperId: vi.fn(() => []),
        listByRootId: vi.fn(() => []),
        listByUser: vi.fn(() => [ownedDiscussion]),
        reparentChildren: vi.fn(),
        update: vi.fn((value) => value),
      },
      papers: {
        deleteByIds: vi.fn(),
        listByUser: vi.fn(() => [ownedPaper]),
        refreshActivitiesByIds: vi.fn(),
        update: vi.fn((value) => value),
      },
      runInTransaction: vi.fn((action) =>
        action({
          annotations: store.annotations,
          discussions: store.discussions,
          papers: store.papers,
          sessions: store.sessions,
          users: usersRepo,
        })
      ),
      sessions: {
        deleteByUserId: vi.fn(),
      },
      users: usersRepo,
    };
    const authService = {
      hashPassword: vi.fn(async (value) => `hashed-${value}`),
      serializeUser: vi.fn((user) => ({
        createdAt: user.createdAt || "",
        id: user.id,
        role: user.role,
        username: user.username,
      })),
      verifyPassword: vi.fn(async (value, hash) => ({
        needsRehash: false,
        ok: value === "old-pass" && hash === "member-hash",
      })),
    };
    const dashboardService = {
      invalidateAll: vi.fn(),
    };
    const usersService = createUsersService({
      HttpError: TestHttpError,
      authService,
      dashboardService,
      deleteSnapshotByPath: vi.fn().mockResolvedValue(undefined),
      deleteSpeechAttachmentsForRecords: vi.fn().mockResolvedValue(undefined),
      normalizeAnnotationRecord: (value) => value,
      normalizeDiscussionRecord: (value) => value,
      normalizePaperRecord: (value) => value,
      store,
    });

    await usersService.changePassword("user-2", {
      currentPassword: "old-pass",
      nextPassword: "new-pass",
    });
    expect(authService.verifyPassword).toHaveBeenCalledWith("old-pass", "member-hash");
    expect(authService.hashPassword).toHaveBeenCalledWith("new-pass");
    expect(usersRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-2",
        mustChangePassword: false,
        passwordHash: "hashed-new-pass",
      })
    );

    const renamedUser = await usersService.changeUsername("user-2", { username: "renamed-member" });
    expect(renamedUser).toEqual(
      expect.objectContaining({
        id: "user-2",
        username: "renamed-member",
      })
    );
    expect(store.papers.update).toHaveBeenCalledWith(
      expect.objectContaining({
        created_by_username: "renamed-member",
      })
    );
    expect(store.annotations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        created_by_username: "renamed-member",
      })
    );
    expect(store.discussions.update).toHaveBeenCalledWith(
      expect.objectContaining({
        created_by_username: "renamed-member",
      })
    );
    expect(store.papers.refreshActivitiesByIds).toHaveBeenCalledWith(["paper-1"]);

    const createdUser = await usersService.createMemberUser({
      password: "pass1234",
      username: "member2",
    });
    expect(createdUser).toEqual(expect.objectContaining({ username: "member2" }));
    expect(usersRepo.insert).toHaveBeenCalledTimes(1);

    const transfer = await usersService.transferAdminRole("user-1", "user-2");
    expect(transfer.currentUser.role).toBe("member");
    expect(transfer.targetUser.role).toBe("admin");
    expect(dashboardService.invalidateAll).toHaveBeenCalledTimes(3);
  });

  it("supports retain and purge deletion paths", async () => {
    class TestHttpError extends Error {
      constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
      }
    }

    const users = [
      {
        id: "user-1",
        username: "admin",
        role: "admin",
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z",
      },
      {
        id: "user-2",
        username: "member1",
        role: "member",
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z",
      },
    ];
    const paper = {
      id: "paper-1",
      created_by_user_id: "user-2",
      created_by_username: "member1",
      snapshotPath: "html/paper-1.html",
    };
    const annotations = [
      { attachments: [], id: "annotation-1", paperId: "paper-1" },
      { attachments: [], id: "annotation-2", paperId: "paper-1" },
    ];
    const discussions = [
      { attachments: [], id: "discussion-1", paperId: "paper-1" },
      { attachments: [], id: "discussion-2", paperId: "paper-1" },
    ];
    const usersRepo = {
      deleteById: vi.fn(),
      getById: vi.fn((userId) => users.find((user) => user.id === userId) || null),
      listAll: vi.fn(() => users.map((user) => ({ ...user }))),
      update: vi.fn((user) => user),
    };
    const store = {
      annotations: {
        deleteById: vi.fn(),
        deleteByIds: vi.fn(),
        deleteByPaperId: vi.fn(),
        getById: vi.fn(() => null),
        listByPaperId: vi.fn(() => annotations),
        listByRootId: vi.fn(() => []),
        listByUser: vi.fn(() => []),
        reparentChildren: vi.fn(),
      },
      discussions: {
        deleteById: vi.fn(),
        deleteByIds: vi.fn(),
        deleteByPaperId: vi.fn(),
        getById: vi.fn(() => null),
        listByPaperId: vi.fn(() => discussions),
        listByRootId: vi.fn(() => []),
        listByUser: vi.fn(() => []),
        reparentChildren: vi.fn(),
      },
      papers: {
        deleteByIds: vi.fn(),
        listByUser: vi.fn(() => [paper]),
        refreshActivitiesByIds: vi.fn(),
      },
      runInTransaction: vi.fn((action) =>
        action({
          annotations: store.annotations,
          discussions: store.discussions,
          papers: store.papers,
          sessions: store.sessions,
          users: usersRepo,
        })
      ),
      sessions: {
        deleteByUserId: vi.fn(),
      },
      users: usersRepo,
    };
    const deleteSnapshotByPath = vi.fn().mockResolvedValue(undefined);
    const deleteSpeechAttachmentsForRecords = vi.fn().mockResolvedValue(undefined);
    const usersService = createUsersService({
      HttpError: TestHttpError,
      authService: {
        hashPassword: vi.fn(),
        serializeUser: vi.fn((user) => user),
        verifyPassword: vi.fn(),
      },
      dashboardService: {
        invalidateAll: vi.fn(),
      },
      deleteSnapshotByPath,
      deleteSpeechAttachmentsForRecords,
      normalizeAnnotationRecord: (value) => value,
      normalizeDiscussionRecord: (value) => value,
      normalizePaperRecord: (value) => value,
      store,
    });

    const retained = await usersService.deleteById("user-1", "user-2", { purgeContent: false });
    expect(retained).toEqual({
      deletedContent: null,
      deletedUserId: "user-2",
      purgeContent: false,
    });
    expect(deleteSnapshotByPath).not.toHaveBeenCalled();
    expect(deleteSpeechAttachmentsForRecords).not.toHaveBeenCalled();

    const purged = await usersService.deleteById("user-1", "user-2", { purgeContent: true });
    expect(purged).toEqual({
      deletedContent: {
        annotationCount: 2,
        discussionCount: 2,
        paperCount: 1,
      },
      deletedUserId: "user-2",
      purgeContent: true,
    });
    expect(deleteSnapshotByPath).toHaveBeenCalledWith("html/paper-1.html");
    expect(deleteSpeechAttachmentsForRecords).toHaveBeenCalledWith([...annotations, ...discussions]);
  });
});

describe("assets service", () => {
  it("primes static assets into memory and serves 200/HEAD/304 without runtime disk reads", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "papershare-assets-"));
    const distDir = path.join(tempDir, "dist");
    const indexPath = path.join(distDir, "src", "client", "catalog", "index.html");
    const assetPath = path.join(distDir, "assets", "app-12345678.js");

    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.writeFile(indexPath, "<!doctype html><html><body>Catalog</body></html>", "utf8");
    await fs.writeFile(assetPath, "console.log('asset');", "utf8");

    const fsWrapper = {
      readFile: vi.fn((...args) => fs.readFile(...args)),
      readdir: vi.fn((...args) => fs.readdir(...args)),
      stat: vi.fn((...args) => fs.stat(...args)),
    };
    const assets = createAssetsService({
      HttpError: class extends Error {
        constructor(statusCode, message) {
          super(message);
          this.statusCode = statusCode;
        }
      },
      attachmentsDir: "/tmp/storage/attachments",
      clientDistDir: distDir,
      fetchElsevierObject: vi.fn(),
      fs: fsWrapper,
      mimeTypeByExtension: {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
      },
      normalizeStorageRecordPath: (value) => String(value || "").trim(),
      path,
      resolveStorageAbsolutePath: (value) => value,
      sendJson: vi.fn((response, statusCode, payload) => {
        response.writeHead(statusCode, {
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(payload));
      }),
      staticAssetCacheControl: "public, max-age=300, must-revalidate",
      staticHashedAssetCacheControl: "public, max-age=31536000, immutable",
      staticHtmlCacheControl: "no-cache",
    });

    await assets.primeStaticAssetCache();
    const statCallsAfterPrime = fsWrapper.stat.mock.calls.length;
    const readFileCallsAfterPrime = fsWrapper.readFile.mock.calls.length;

    const homeResponse = createResponseRecorder();
    await assets.serveStaticAsset({ headers: {}, method: "GET" }, "/", homeResponse);
    expect(homeResponse.statusCode).toBe(200);
    expect(homeResponse.headers["Cache-Control"]).toBe("no-cache");
    expect(homeResponse.body.toString("utf8")).toContain("Catalog");

    const assetResponse = createResponseRecorder();
    await assets.serveStaticAsset({ headers: {}, method: "GET" }, "/assets/app-12345678.js", assetResponse);
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(assetResponse.body.toString("utf8")).toContain("console.log");

    const headResponse = createResponseRecorder();
    await assets.serveStaticAsset({ headers: {}, method: "HEAD" }, "/assets/app-12345678.js", headResponse);
    expect(headResponse.statusCode).toBe(200);
    expect(headResponse.body.length).toBe(0);

    const etagResponse = createResponseRecorder();
    await assets.serveStaticAsset(
      {
        headers: {
          "if-none-match": assetResponse.headers.ETag,
        },
        method: "GET",
      },
      "/assets/app-12345678.js",
      etagResponse
    );
    expect(etagResponse.statusCode).toBe(304);
    expect(fsWrapper.stat).toHaveBeenCalledTimes(statCallsAfterPrime);
    expect(fsWrapper.readFile).toHaveBeenCalledTimes(readFileCallsAfterPrime);

    await fs.rm(tempDir, { force: true, recursive: true });
  });
});
