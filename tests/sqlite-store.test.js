import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { TABLES, createSqliteStore } = require("../src/server/storage/sqlite-store");

async function createStorageDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "papershare-store-test-"));
}

afterEach(() => {
  delete process.env.PAPERSHARE_STORAGE_DIR;
});

describe("sqlite-store repositories", () => {
  it("supports row-level CRUD, session replacement, and reply reparenting", async () => {
    const storageDir = await createStorageDir();
    const store = createSqliteStore({
      storageDir,
      jsonFilePaths: {
        [TABLES.PAPERS]: path.join(storageDir, "papers.json"),
        [TABLES.ANNOTATIONS]: path.join(storageDir, "annotations.json"),
        [TABLES.DISCUSSIONS]: path.join(storageDir, "discussions.json"),
        [TABLES.USERS]: path.join(storageDir, "users.json"),
        [TABLES.SESSIONS]: path.join(storageDir, "sessions.json"),
      },
    });

    await store.ensureReady();

    store.users.insert({
      id: "user-1",
      username: "alice",
      role: "member",
      passwordHash: "hash-1",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
    });
    store.papers.insert({
      id: "paper-1",
      sourceUrl: "https://example.org/paper-1",
      title: "A Row-Level Paper",
      created_by_user_id: "user-1",
      created_by_username: "alice",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
      fetchedAt: "2026-04-15T00:00:00.000Z",
      snapshotPath: "html/paper-1.html",
    });
    store.annotations.insert({
      id: "annotation-1",
      paperId: "paper-1",
      note: "root",
      exact: "root",
      prefix: "",
      suffix: "",
      target_scope: "body",
      start_offset: 0,
      end_offset: 4,
      created_by_user_id: "user-1",
      created_by_username: "alice",
      created_at: "2026-04-15T00:01:00.000Z",
      parent_annotation_id: "",
      root_annotation_id: "annotation-1",
      attachments: [],
    });
    store.annotations.insert({
      id: "annotation-2",
      paperId: "paper-1",
      note: "reply",
      exact: "root",
      prefix: "",
      suffix: "",
      target_scope: "body",
      start_offset: 0,
      end_offset: 4,
      created_by_user_id: "user-1",
      created_by_username: "alice",
      created_at: "2026-04-15T00:02:00.000Z",
      parent_annotation_id: "annotation-1",
      root_annotation_id: "annotation-1",
      attachments: [],
    });
    store.annotations.insert({
      id: "annotation-3",
      paperId: "paper-1",
      note: "nested",
      exact: "root",
      prefix: "",
      suffix: "",
      target_scope: "body",
      start_offset: 0,
      end_offset: 4,
      created_by_user_id: "user-1",
      created_by_username: "alice",
      created_at: "2026-04-15T00:03:00.000Z",
      parent_annotation_id: "annotation-2",
      root_annotation_id: "annotation-1",
      attachments: [],
    });
    store.discussions.insert({
      id: "discussion-1",
      paperId: "paper-1",
      note: "discussion",
      created_by_user_id: "user-1",
      created_by_username: "alice",
      created_at: "2026-04-15T00:04:00.000Z",
      parent_discussion_id: "",
      root_discussion_id: "discussion-1",
      attachments: [],
    });

    expect(store.users.getByUsername("alice")?.id).toBe("user-1");
    expect(store.papers.getBySourceUrl("https://example.org/paper-1")?.id).toBe("paper-1");
    expect(store.annotations.listByPaperId("paper-1")).toHaveLength(3);
    expect(store.discussions.listByPaperId("paper-1")).toHaveLength(1);

    const refreshedPaper = store.papers.refreshActivityById("paper-1");
    const storedActivityPaper = store.papers.listWithActivity()[0];
    const paperColumns = store
      .getDatabase()
      .prepare("PRAGMA table_info(papers)")
      .all()
      .map((column) => column.name);

    expect(paperColumns).toContain("speech_count");
    expect(refreshedPaper?.speechCount).toBe(4);
    expect(refreshedPaper?.latestSpeakerUsername).toBe("alice");
    expect(refreshedPaper?.latestSpeechAt).toBe("2026-04-15T00:04:00.000Z");
    expect(storedActivityPaper?.speechCount).toBe(4);

    store.annotations.reparentChildren("annotation-2", "annotation-1");
    expect(store.annotations.getById("annotation-3")?.parent_annotation_id).toBe("annotation-1");

    store.sessions.replaceSessionForUser({
      token: "session-1",
      userId: "user-1",
      createdAt: "2026-04-15T00:04:00.000Z",
    });
    store.sessions.replaceSessionForUser({
      token: "session-2",
      userId: "user-1",
      createdAt: "2026-04-15T00:05:00.000Z",
    });

    expect(store.sessions.listByUserId("user-1")).toHaveLength(1);
    expect(store.sessions.getByToken("session-2")?.userId).toBe("user-1");

    store.annotations.deleteByPaperId("paper-1");
    expect(store.annotations.listByPaperId("paper-1")).toHaveLength(0);
    expect(await store.getCollectionLength(path.join(storageDir, "papers.json"))).toBe(1);

    await store.close();
  });

  it("backfills missing ownership and chunks listByIds queries", async () => {
    const storageDir = await createStorageDir();
    const store = createSqliteStore({
      storageDir,
      jsonFilePaths: {
        [TABLES.PAPERS]: path.join(storageDir, "papers.json"),
        [TABLES.ANNOTATIONS]: path.join(storageDir, "annotations.json"),
        [TABLES.DISCUSSIONS]: path.join(storageDir, "discussions.json"),
        [TABLES.USERS]: path.join(storageDir, "users.json"),
        [TABLES.SESSIONS]: path.join(storageDir, "sessions.json"),
      },
    });

    await store.ensureReady();

    store.users.insert({
      id: "user-1",
      username: "Alice",
      role: "member",
      passwordHash: "hash-1",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
    });

    store.papers.insert({
      id: "paper-owned",
      sourceUrl: "https://example.org/paper-owned",
      title: "Owned Paper",
      created_by_user_id: "",
      created_by_username: "Alice",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
      fetchedAt: "2026-04-15T00:00:00.000Z",
      snapshotPath: "html/paper-owned.html",
    });
    store.papers.insert({
      id: "paper-orphan",
      sourceUrl: "https://example.org/paper-orphan",
      title: "Orphan Paper",
      created_by_user_id: "",
      created_by_username: "ghost",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
      fetchedAt: "2026-04-15T00:00:00.000Z",
      snapshotPath: "html/paper-orphan.html",
    });
    store.annotations.insert({
      id: "annotation-owned",
      paperId: "paper-owned",
      note: "owned annotation",
      exact: "owned",
      prefix: "",
      suffix: "",
      target_scope: "body",
      start_offset: 0,
      end_offset: 5,
      created_by_user_id: "",
      created_by_username: "Alice",
      created_at: "2026-04-15T00:01:00.000Z",
      parent_annotation_id: "",
      root_annotation_id: "annotation-owned",
      attachments: [],
    });
    store.annotations.insert({
      id: "annotation-orphan",
      paperId: "paper-owned",
      note: "orphan annotation",
      exact: "orphan",
      prefix: "",
      suffix: "",
      target_scope: "body",
      start_offset: 0,
      end_offset: 6,
      created_by_user_id: "",
      created_by_username: "ghost",
      created_at: "2026-04-15T00:02:00.000Z",
      parent_annotation_id: "",
      root_annotation_id: "annotation-orphan",
      attachments: [],
    });
    store.discussions.insert({
      id: "discussion-owned",
      paperId: "paper-owned",
      note: "owned discussion",
      created_by_user_id: "",
      created_by_username: "Alice",
      created_at: "2026-04-15T00:03:00.000Z",
      parent_discussion_id: "",
      root_discussion_id: "discussion-owned",
      attachments: [],
    });
    store.discussions.insert({
      id: "discussion-orphan",
      paperId: "paper-owned",
      note: "orphan discussion",
      created_by_user_id: "",
      created_by_username: "ghost",
      created_at: "2026-04-15T00:04:00.000Z",
      parent_discussion_id: "",
      root_discussion_id: "discussion-orphan",
      attachments: [],
    });

    const backfillResult = store.backfillOwnership();

    expect(backfillResult).toMatchObject({
      annotations: { updatedCount: 1, unmatchedCount: 1 },
      discussions: { updatedCount: 1, unmatchedCount: 1 },
      papers: { updatedCount: 1, unmatchedCount: 1 },
    });
    expect(store.papers.getById("paper-owned")?.created_by_user_id).toBe("user-1");
    expect(store.annotations.getById("annotation-owned")?.created_by_user_id).toBe("user-1");
    expect(store.discussions.getById("discussion-owned")?.created_by_user_id).toBe("user-1");
    expect(
      JSON.parse(
        store.getDatabase().prepare("SELECT json FROM papers WHERE id = ?").get("paper-owned").json
      ).created_by_user_id
    ).toBe("user-1");

    const secondPass = store.backfillOwnership();

    expect(secondPass).toMatchObject({
      annotations: { updatedCount: 0, unmatchedCount: 1 },
      discussions: { updatedCount: 0, unmatchedCount: 1 },
      papers: { updatedCount: 0, unmatchedCount: 1 },
    });

    const chunkedPaperIds = [];
    const chunkedAnnotationIds = [];

    store.runInTransaction((repositories) => {
      for (let index = 0; index < 905; index += 1) {
        const paperId = `paper-chunk-${index}`;
        const annotationId = `annotation-chunk-${index}`;

        repositories.papers.insert({
          id: paperId,
          sourceUrl: `https://example.org/${paperId}`,
          title: `Chunked Paper ${index}`,
          created_by_user_id: "user-1",
          created_by_username: "Alice",
          createdAt: "2026-04-15T00:00:00.000Z",
          updatedAt: "2026-04-15T00:00:00.000Z",
          fetchedAt: "2026-04-15T00:00:00.000Z",
          snapshotPath: `html/${paperId}.html`,
        });
        repositories.annotations.insert({
          id: annotationId,
          paperId: "paper-owned",
          note: `Chunked annotation ${index}`,
          exact: "chunked",
          prefix: "",
          suffix: "",
          target_scope: "body",
          start_offset: 0,
          end_offset: 7,
          created_by_user_id: "user-1",
          created_by_username: "Alice",
          created_at: "2026-04-15T00:05:00.000Z",
          parent_annotation_id: "",
          root_annotation_id: annotationId,
          attachments: [],
        });

        chunkedPaperIds.push(paperId);
        chunkedAnnotationIds.push(annotationId);
      }
    });

    const chunkedPapers = store.papers.listByIds(chunkedPaperIds);
    const chunkedAnnotations = store.annotations.listByIds(chunkedAnnotationIds);

    expect(chunkedPapers).toHaveLength(905);
    expect(chunkedAnnotations).toHaveLength(905);
    expect(chunkedPapers.some((paper) => paper.id === "paper-chunk-904")).toBe(true);
    expect(chunkedAnnotations.some((annotation) => annotation.id === "annotation-chunk-904")).toBe(true);

    await store.close();
  });
});
