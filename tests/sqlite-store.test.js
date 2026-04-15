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

    expect(store.users.getByUsername("alice")?.id).toBe("user-1");
    expect(store.papers.getBySourceUrl("https://example.org/paper-1")?.id).toBe("paper-1");
    expect(store.annotations.listByPaperId("paper-1")).toHaveLength(3);

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
});
