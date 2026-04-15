const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const Database = require("better-sqlite3");

const DB_FILENAME = "papershare.sqlite";
const BACKUP_DIRNAME = "migration-backups";

const TABLES = Object.freeze({
  PAPERS: "papers",
  ANNOTATIONS: "annotations",
  DISCUSSIONS: "discussions",
  USERS: "users",
  SESSIONS: "sessions",
});

const COLLECTION_FILE_TO_TABLE = Object.freeze({
  "papers.json": TABLES.PAPERS,
  "annotations.json": TABLES.ANNOTATIONS,
  "discussions.json": TABLES.DISCUSSIONS,
  "users.json": TABLES.USERS,
  "sessions.json": TABLES.SESSIONS,
});

function createSqliteStore(options) {
  const storageDir = options.storageDir;
  const dbPath = path.join(storageDir, DB_FILENAME);
  const jsonFilePaths = Object.freeze({ ...(options.jsonFilePaths || {}) });
  let db = null;
  let repositories = null;

  function openDatabase() {
    if (db) {
      return db;
    }

    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = OFF");
    ensureSchema(db);
    repositories = createRepositories(db);
    return db;
  }

  function getRepositories(database = openDatabase()) {
    if (database === db && repositories) {
      return repositories;
    }

    return createRepositories(database);
  }

  async function ensureReady() {
    await fs.mkdir(storageDir, { recursive: true });
    const database = openDatabase();
    await migrateLegacyJsonIfNeeded(database);
  }

  async function close() {
    if (!db) {
      return;
    }

    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch (error) {
      // Ignore checkpoint failures during shutdown and still close the handle.
    }

    db.close();
    db = null;
    repositories = null;
  }

  async function getCollectionLength(filePath) {
    const tableName = resolveTableName(filePath);

    if (!tableName) {
      return 0;
    }

    return readTableCount(openDatabase(), tableName);
  }

  function runInTransaction(action) {
    const database = openDatabase();
    const transaction = database.transaction(() => action(getRepositories(database)));
    return transaction();
  }

  async function migrateLegacyJsonIfNeeded(database) {
    if (!isDatabaseEmpty(database)) {
      return;
    }

    const existingJsonFiles = Object.values(jsonFilePaths).filter((filePath) => fsSync.existsSync(filePath));

    if (!existingJsonFiles.length) {
      return;
    }

    const collections = {};

    for (const [tableName, filePath] of Object.entries(jsonFilePaths)) {
      collections[tableName] = await readLegacyJsonFile(filePath);
    }

    const backupDir = path.join(storageDir, BACKUP_DIRNAME, createMigrationStamp());
    await fs.mkdir(backupDir, { recursive: true });

    for (const filePath of existingJsonFiles) {
      await fs.copyFile(filePath, path.join(backupDir, path.basename(filePath)));
    }

    database.transaction(() => {
      Object.entries(collections).forEach(([tableName, items]) => {
        replaceCollectionSync(database, tableName, items);
      });
    })();

    Object.entries(collections).forEach(([tableName, items]) => {
      const importedCount = readTableCount(database, tableName);

      if (importedCount !== items.length) {
        throw new Error(
          `Legacy JSON migration count mismatch for ${tableName}: expected ${items.length}, got ${importedCount}`
        );
      }
    });
  }

  return {
    close,
    ensureReady,
    getCollectionLength,
    getDatabase: openDatabase,
    runInTransaction,
    get papers() {
      return getRepositories().papers;
    },
    get annotations() {
      return getRepositories().annotations;
    },
    get discussions() {
      return getRepositories().discussions;
    },
    get users() {
      return getRepositories().users;
    },
    get sessions() {
      return getRepositories().sessions;
    },
  };
}

function createRepositories(db) {
  return {
    annotations: createSpeechRepository(db, {
      idColumn: "id",
      parentKey: "parent_annotation_id",
      parentColumn: "parent_annotation_id",
      rootKey: "root_annotation_id",
      rootColumn: "root_annotation_id",
      tableName: TABLES.ANNOTATIONS,
    }),
    discussions: createSpeechRepository(db, {
      idColumn: "id",
      parentKey: "parent_discussion_id",
      parentColumn: "parent_discussion_id",
      rootKey: "root_discussion_id",
      rootColumn: "root_discussion_id",
      tableName: TABLES.DISCUSSIONS,
    }),
    papers: createPaperRepository(db),
    sessions: createSessionRepository(db),
    users: createUserRepository(db),
  };
}

function createUserRepository(db) {
  const selectAllStatement = db.prepare(`
    SELECT json
    FROM users
    ORDER BY username COLLATE NOCASE ASC, rowid ASC
  `);
  const selectByIdStatement = db.prepare(`
    SELECT json
    FROM users
    WHERE id = ?
  `);
  const selectByUsernameStatement = db.prepare(`
    SELECT json
    FROM users
    WHERE username = ? COLLATE NOCASE
    LIMIT 1
  `);
  const insertStatement = db.prepare(createInsertStatement(TABLES.USERS));
  const updateStatement = db.prepare(`
    UPDATE users
    SET
      username = @username,
      role = @role,
      password_hash = @password_hash,
      created_at = @created_at,
      updated_at = @updated_at,
      json = @json
    WHERE id = @id
  `);
  const deleteByIdStatement = db.prepare(`
    DELETE FROM users
    WHERE id = ?
  `);
  const countStatement = db.prepare(`SELECT COUNT(*) AS count FROM users`);

  return {
    countAll() {
      return Number(countStatement.get()?.count || 0);
    },
    deleteById(userId) {
      return deleteByIdStatement.run(normalizeText(userId)).changes;
    },
    getById(userId) {
      return parseJsonRow(selectByIdStatement.get(normalizeText(userId)));
    },
    getByUsername(username) {
      return parseJsonRow(selectByUsernameStatement.get(normalizeText(username)));
    },
    insert(user) {
      insertStatement.run(buildRecordParams(TABLES.USERS, user));
      return user;
    },
    listAll() {
      return parseJsonRows(selectAllStatement.all());
    },
    update(user) {
      updateStatement.run(buildRecordParams(TABLES.USERS, user));
      return user;
    },
  };
}

function createSessionRepository(db) {
  const selectByTokenStatement = db.prepare(`
    SELECT json
    FROM sessions
    WHERE token = ?
  `);
  const selectByUserIdStatement = db.prepare(`
    SELECT json
    FROM sessions
    WHERE user_id = ?
    ORDER BY created_at DESC, rowid DESC
  `);
  const insertStatement = db.prepare(createInsertStatement(TABLES.SESSIONS));
  const updateStatement = db.prepare(`
    UPDATE sessions
    SET
      user_id = @user_id,
      created_at = @created_at,
      json = @json
    WHERE token = @token
  `);
  const deleteByTokenStatement = db.prepare(`
    DELETE FROM sessions
    WHERE token = ?
  `);
  const deleteByUserIdStatement = db.prepare(`
    DELETE FROM sessions
    WHERE user_id = ?
  `);
  const countStatement = db.prepare(`SELECT COUNT(*) AS count FROM sessions`);

  return {
    countAll() {
      return Number(countStatement.get()?.count || 0);
    },
    deleteByToken(token) {
      return deleteByTokenStatement.run(normalizeText(token)).changes;
    },
    deleteByUserId(userId) {
      return deleteByUserIdStatement.run(normalizeText(userId)).changes;
    },
    getByToken(token) {
      return parseJsonRow(selectByTokenStatement.get(normalizeText(token)));
    },
    insert(session) {
      insertStatement.run(buildRecordParams(TABLES.SESSIONS, session));
      return session;
    },
    listByUserId(userId) {
      return parseJsonRows(selectByUserIdStatement.all(normalizeText(userId)));
    },
    replaceSessionForUser(session) {
      deleteByUserIdStatement.run(normalizeText(session?.userId));
      insertStatement.run(buildRecordParams(TABLES.SESSIONS, session));
      return session;
    },
    update(session) {
      updateStatement.run(buildRecordParams(TABLES.SESSIONS, session));
      return session;
    },
  };
}

function createPaperRepository(db) {
  const selectAllStatement = db.prepare(`
    SELECT json
    FROM papers
    ORDER BY COALESCE(NULLIF(updated_at, ''), NULLIF(created_at, ''), NULLIF(fetched_at, '')) DESC, rowid DESC
  `);
  const selectByIdStatement = db.prepare(`
    SELECT json
    FROM papers
    WHERE id = ?
  `);
  const selectBySourceUrlStatement = db.prepare(`
    SELECT json
    FROM papers
    WHERE source_url = ?
  `);
  const selectByUserStatement = db.prepare(`
    SELECT json
    FROM papers
    WHERE created_by_user_id = ?
      OR (created_by_user_id = '' AND created_by_username = ?)
    ORDER BY COALESCE(NULLIF(updated_at, ''), NULLIF(created_at, ''), NULLIF(fetched_at, '')) DESC, rowid DESC
  `);
  const selectByCreatedByUserIdStatement = db.prepare(`
    SELECT json
    FROM papers
    WHERE created_by_user_id = ?
    ORDER BY rowid ASC
  `);
  const insertStatement = db.prepare(createInsertStatement(TABLES.PAPERS));
  const updateStatement = db.prepare(`
    UPDATE papers
    SET
      source_url = @source_url,
      created_by_user_id = @created_by_user_id,
      created_by_username = @created_by_username,
      created_at = @created_at,
      updated_at = @updated_at,
      fetched_at = @fetched_at,
      snapshot_path = @snapshot_path,
      title = @title,
      latest_speech_at = @latest_speech_at,
      latest_speaker_username = @latest_speaker_username,
      json = @json
    WHERE id = @id
  `);
  const deleteByIdStatement = db.prepare(`
    DELETE FROM papers
    WHERE id = ?
  `);
  const countStatement = db.prepare(`SELECT COUNT(*) AS count FROM papers`);
  const listWithActivityStatement = db.prepare(`
    SELECT
      papers.json AS json,
      (
        SELECT COUNT(*)
        FROM annotations
        WHERE annotations.paper_id = papers.id
      ) + (
        SELECT COUNT(*)
        FROM discussions
        WHERE discussions.paper_id = papers.id
      ) AS speech_count,
      COALESCE((
        SELECT speech.created_at
        FROM (
          SELECT created_at, rowid
          FROM annotations
          WHERE paper_id = papers.id
          UNION ALL
          SELECT created_at, rowid
          FROM discussions
          WHERE paper_id = papers.id
        ) AS speech
        ORDER BY speech.created_at DESC, speech.rowid DESC
        LIMIT 1
      ), '') AS latest_speech_at,
      COALESCE((
        SELECT speech.created_by_username
        FROM (
          SELECT created_at, created_by_username, rowid
          FROM annotations
          WHERE paper_id = papers.id
          UNION ALL
          SELECT created_at, created_by_username, rowid
          FROM discussions
          WHERE paper_id = papers.id
        ) AS speech
        ORDER BY speech.created_at DESC, speech.rowid DESC
        LIMIT 1
      ), '') AS latest_speaker_username
    FROM papers
    ORDER BY COALESCE(
      NULLIF((
        SELECT speech.created_at
        FROM (
          SELECT created_at, rowid
          FROM annotations
          WHERE paper_id = papers.id
          UNION ALL
          SELECT created_at, rowid
          FROM discussions
          WHERE paper_id = papers.id
        ) AS speech
        ORDER BY speech.created_at DESC, speech.rowid DESC
        LIMIT 1
      ), ''),
      NULLIF(papers.updated_at, ''),
      NULLIF(papers.created_at, ''),
      NULLIF(papers.fetched_at, '')
    ) DESC, papers.rowid DESC
  `);

  return {
    countAll() {
      return Number(countStatement.get()?.count || 0);
    },
    deleteById(paperId) {
      return deleteByIdStatement.run(normalizeText(paperId)).changes;
    },
    deleteByIds(paperIds) {
      return deleteByIds(db, TABLES.PAPERS, "id", paperIds);
    },
    getById(paperId) {
      return parseJsonRow(selectByIdStatement.get(normalizeText(paperId)));
    },
    getBySourceUrl(sourceUrl) {
      return parseJsonRow(selectBySourceUrlStatement.get(normalizeText(sourceUrl)));
    },
    insert(paper) {
      insertStatement.run(buildRecordParams(TABLES.PAPERS, paper));
      return paper;
    },
    listAll() {
      return parseJsonRows(selectAllStatement.all());
    },
    listByIds(paperIds) {
      return listByIds(db, TABLES.PAPERS, paperIds);
    },
    listByUser(userId, username) {
      return parseJsonRows(selectByUserStatement.all(normalizeText(userId), normalizeText(username)));
    },
    listByUserId(userId) {
      return parseJsonRows(selectByCreatedByUserIdStatement.all(normalizeText(userId)));
    },
    listWithActivity() {
      return listWithActivityStatement.all().map((row) => ({
        ...parseJsonRow(row),
        latestSpeakerUsername: String(row?.latest_speaker_username || "").trim(),
        latestSpeechAt: String(row?.latest_speech_at || "").trim(),
        speechCount: Number(row?.speech_count || 0),
      }));
    },
    update(paper) {
      updateStatement.run(buildRecordParams(TABLES.PAPERS, paper));
      return paper;
    },
    updateCreatedByUsername(userId, username) {
      const papers = parseJsonRows(selectByCreatedByUserIdStatement.all(normalizeText(userId)));
      papers.forEach((paper) => {
        updateStatement.run(
          buildRecordParams(TABLES.PAPERS, {
            ...paper,
            created_by_username: username,
          })
        );
      });
      return papers.length;
    },
  };
}

function createSpeechRepository(db, options) {
  const tableName = options.tableName;
  const idColumn = options.idColumn;
  const parentKey = options.parentKey;
  const parentColumn = options.parentColumn;
  const rootKey = options.rootKey;
  const rootColumn = options.rootColumn;
  const selectAllStatement = db.prepare(`
    SELECT json
    FROM ${tableName}
    ORDER BY created_at ASC, rowid ASC
  `);
  const selectByIdStatement = db.prepare(`
    SELECT json
    FROM ${tableName}
    WHERE ${idColumn} = ?
  `);
  const selectByPaperIdStatement = db.prepare(`
    SELECT json
    FROM ${tableName}
    WHERE paper_id = ?
    ORDER BY created_at ASC, rowid ASC
  `);
  const selectByRootIdStatement = db.prepare(`
    SELECT json
    FROM ${tableName}
    WHERE ${rootColumn} = ?
    ORDER BY created_at ASC, rowid ASC
  `);
  const selectChildrenByParentIdStatement = db.prepare(`
    SELECT json
    FROM ${tableName}
    WHERE ${parentColumn} = ?
    ORDER BY created_at ASC, rowid ASC
  `);
  const selectByUserStatement = db.prepare(`
    SELECT json
    FROM ${tableName}
    WHERE created_by_user_id = ?
      OR (created_by_user_id = '' AND created_by_username = ?)
    ORDER BY created_at DESC, rowid DESC
  `);
  const selectByCreatedByUserIdStatement = db.prepare(`
    SELECT json
    FROM ${tableName}
    WHERE created_by_user_id = ?
    ORDER BY rowid ASC
  `);
  const insertStatement = db.prepare(createInsertStatement(tableName));
  const updateStatement = db.prepare(createSpeechUpdateStatement(tableName));
  const deleteByIdStatement = db.prepare(`
    DELETE FROM ${tableName}
    WHERE ${idColumn} = ?
  `);
  const deleteByPaperIdStatement = db.prepare(`
    DELETE FROM ${tableName}
    WHERE paper_id = ?
  `);
  const countStatement = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`);

  return {
    countAll() {
      return Number(countStatement.get()?.count || 0);
    },
    deleteById(id) {
      return deleteByIdStatement.run(normalizeText(id)).changes;
    },
    deleteByIds(ids) {
      return deleteByIds(db, tableName, idColumn, ids);
    },
    deleteByPaperId(paperId) {
      return deleteByPaperIdStatement.run(normalizeText(paperId)).changes;
    },
    getById(id) {
      return parseJsonRow(selectByIdStatement.get(normalizeText(id)));
    },
    insert(record) {
      insertStatement.run(buildRecordParams(tableName, record));
      return record;
    },
    listAll() {
      return parseJsonRows(selectAllStatement.all());
    },
    listByIds(ids) {
      return listByIds(db, tableName, ids);
    },
    listByPaperId(paperId) {
      return parseJsonRows(selectByPaperIdStatement.all(normalizeText(paperId)));
    },
    listByRootId(rootId) {
      return parseJsonRows(selectByRootIdStatement.all(normalizeText(rootId)));
    },
    listByUser(userId, username) {
      return parseJsonRows(selectByUserStatement.all(normalizeText(userId), normalizeText(username)));
    },
    listByUserId(userId) {
      return parseJsonRows(selectByCreatedByUserIdStatement.all(normalizeText(userId)));
    },
    listChildrenByParentId(parentId) {
      return parseJsonRows(selectChildrenByParentIdStatement.all(normalizeText(parentId)));
    },
    reparentChildren(oldParentId, newParentId) {
      const children = parseJsonRows(
        selectChildrenByParentIdStatement.all(normalizeText(oldParentId))
      );

      children.forEach((child) => {
        updateStatement.run(
          buildRecordParams(tableName, {
            ...child,
            [parentKey]: normalizeText(newParentId),
          })
        );
      });

      return children.length;
    },
    update(record) {
      updateStatement.run(buildRecordParams(tableName, record));
      return record;
    },
    updateCreatedByUsername(userId, username) {
      const records = parseJsonRows(selectByCreatedByUserIdStatement.all(normalizeText(userId)));
      records.forEach((record) => {
        updateStatement.run(
          buildRecordParams(tableName, {
            ...record,
            created_by_username: username,
          })
        );
      });
      return records.length;
    },
  };
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      password_hash TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      source_url TEXT,
      created_by_user_id TEXT,
      created_by_username TEXT,
      created_at TEXT,
      updated_at TEXT,
      fetched_at TEXT,
      snapshot_path TEXT,
      title TEXT,
      latest_speech_at TEXT,
      latest_speaker_username TEXT,
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      parent_annotation_id TEXT,
      root_annotation_id TEXT,
      created_by_user_id TEXT,
      created_by_username TEXT,
      created_at TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS discussions (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL,
      parent_discussion_id TEXT,
      root_discussion_id TEXT,
      created_by_user_id TEXT,
      created_by_username TEXT,
      created_at TEXT,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_papers_source_url ON papers (source_url);
    CREATE INDEX IF NOT EXISTS idx_papers_created_by_user_id ON papers (created_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_paper_id ON annotations (paper_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_root_annotation_id ON annotations (root_annotation_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_parent_annotation_id ON annotations (parent_annotation_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_created_by_user_id ON annotations (created_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_discussions_paper_id ON discussions (paper_id);
    CREATE INDEX IF NOT EXISTS idx_discussions_root_discussion_id ON discussions (root_discussion_id);
    CREATE INDEX IF NOT EXISTS idx_discussions_parent_discussion_id ON discussions (parent_discussion_id);
    CREATE INDEX IF NOT EXISTS idx_discussions_created_by_user_id ON discussions (created_by_user_id);
  `);
}

function resolveTableName(filePath) {
  return COLLECTION_FILE_TO_TABLE[path.basename(String(filePath || ""))] || "";
}

function isDatabaseEmpty(db) {
  const totalCount =
    readTableCount(db, TABLES.PAPERS) +
    readTableCount(db, TABLES.ANNOTATIONS) +
    readTableCount(db, TABLES.DISCUSSIONS) +
    readTableCount(db, TABLES.USERS) +
    readTableCount(db, TABLES.SESSIONS);

  return totalCount === 0;
}

function readTableCount(db, tableName) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
  return Number(row?.count || 0);
}

async function readLegacyJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const value = raw.trim() ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function replaceCollectionSync(db, tableName, items) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const deleteStatement = db.prepare(`DELETE FROM ${tableName}`);
  const insertStatement = db.prepare(createInsertStatement(tableName));

  db.transaction(() => {
    deleteStatement.run();

    normalizedItems.forEach((item) => {
      insertStatement.run(buildRecordParams(tableName, item));
    });
  })();
}

function createInsertStatement(tableName) {
  if (tableName === TABLES.USERS) {
    return `
      INSERT INTO users (id, username, role, password_hash, created_at, updated_at, json)
      VALUES (@id, @username, @role, @password_hash, @created_at, @updated_at, @json)
    `;
  }

  if (tableName === TABLES.SESSIONS) {
    return `
      INSERT INTO sessions (token, user_id, created_at, json)
      VALUES (@token, @user_id, @created_at, @json)
    `;
  }

  if (tableName === TABLES.PAPERS) {
    return `
      INSERT INTO papers (
        id,
        source_url,
        created_by_user_id,
        created_by_username,
        created_at,
        updated_at,
        fetched_at,
        snapshot_path,
        title,
        latest_speech_at,
        latest_speaker_username,
        json
      )
      VALUES (
        @id,
        @source_url,
        @created_by_user_id,
        @created_by_username,
        @created_at,
        @updated_at,
        @fetched_at,
        @snapshot_path,
        @title,
        @latest_speech_at,
        @latest_speaker_username,
        @json
      )
    `;
  }

  if (tableName === TABLES.ANNOTATIONS) {
    return `
      INSERT INTO annotations (
        id,
        paper_id,
        parent_annotation_id,
        root_annotation_id,
        created_by_user_id,
        created_by_username,
        created_at,
        attachments_json,
        json
      )
      VALUES (
        @id,
        @paper_id,
        @parent_annotation_id,
        @root_annotation_id,
        @created_by_user_id,
        @created_by_username,
        @created_at,
        @attachments_json,
        @json
      )
    `;
  }

  return `
    INSERT INTO discussions (
      id,
      paper_id,
      parent_discussion_id,
      root_discussion_id,
      created_by_user_id,
      created_by_username,
      created_at,
      attachments_json,
      json
    )
    VALUES (
      @id,
      @paper_id,
      @parent_discussion_id,
      @root_discussion_id,
      @created_by_user_id,
      @created_by_username,
      @created_at,
      @attachments_json,
      @json
    )
  `;
}

function createSpeechUpdateStatement(tableName) {
  if (tableName === TABLES.ANNOTATIONS) {
    return `
      UPDATE annotations
      SET
        paper_id = @paper_id,
        parent_annotation_id = @parent_annotation_id,
        root_annotation_id = @root_annotation_id,
        created_by_user_id = @created_by_user_id,
        created_by_username = @created_by_username,
        created_at = @created_at,
        attachments_json = @attachments_json,
        json = @json
      WHERE id = @id
    `;
  }

  return `
    UPDATE discussions
    SET
      paper_id = @paper_id,
      parent_discussion_id = @parent_discussion_id,
      root_discussion_id = @root_discussion_id,
      created_by_user_id = @created_by_user_id,
      created_by_username = @created_by_username,
      created_at = @created_at,
      attachments_json = @attachments_json,
      json = @json
    WHERE id = @id
  `;
}

function buildRecordParams(tableName, record) {
  const item = record && typeof record === "object" ? record : {};
  const json = JSON.stringify(item);

  if (tableName === TABLES.USERS) {
    return {
      id: normalizeText(item.id),
      username: normalizeText(item.username),
      role: normalizeText(item.role || "member"),
      password_hash: normalizeText(item.passwordHash),
      created_at: normalizeText(item.createdAt),
      updated_at: normalizeText(item.updatedAt),
      json,
    };
  }

  if (tableName === TABLES.SESSIONS) {
    return {
      token: normalizeText(item.token),
      user_id: normalizeText(item.userId),
      created_at: normalizeText(item.createdAt),
      json,
    };
  }

  if (tableName === TABLES.PAPERS) {
    return {
      id: normalizeText(item.id),
      source_url: normalizeText(item.sourceUrl),
      created_by_user_id: normalizeText(item.created_by_user_id),
      created_by_username: normalizeText(item.created_by_username),
      created_at: normalizeText(item.createdAt),
      updated_at: normalizeText(item.updatedAt),
      fetched_at: normalizeText(item.fetchedAt),
      snapshot_path: normalizeText(item.snapshotPath),
      title: normalizeText(item.title),
      latest_speech_at: normalizeText(item.latestSpeechAt),
      latest_speaker_username: normalizeText(item.latestSpeakerUsername),
      json,
    };
  }

  if (tableName === TABLES.ANNOTATIONS) {
    return {
      id: normalizeText(item.id),
      paper_id: normalizeText(item.paperId),
      parent_annotation_id: normalizeText(item.parent_annotation_id),
      root_annotation_id: normalizeText(item.root_annotation_id),
      created_by_user_id: normalizeText(item.created_by_user_id),
      created_by_username: normalizeText(item.created_by_username),
      created_at: normalizeText(item.created_at),
      attachments_json: JSON.stringify(Array.isArray(item.attachments) ? item.attachments : []),
      json,
    };
  }

  return {
    id: normalizeText(item.id),
    paper_id: normalizeText(item.paperId),
    parent_discussion_id: normalizeText(item.parent_discussion_id),
    root_discussion_id: normalizeText(item.root_discussion_id),
    created_by_user_id: normalizeText(item.created_by_user_id),
    created_by_username: normalizeText(item.created_by_username),
    created_at: normalizeText(item.created_at),
    attachments_json: JSON.stringify(Array.isArray(item.attachments) ? item.attachments : []),
    json,
  };
}

function parseJsonRow(row) {
  return row ? JSON.parse(row.json) : null;
}

function parseJsonRows(rows) {
  return rows.map((row) => JSON.parse(row.json));
}

function listByIds(db, tableName, ids) {
  const normalizedIds = Array.from(
    new Set((Array.isArray(ids) ? ids : []).map((id) => normalizeText(id)).filter(Boolean))
  );

  if (!normalizedIds.length) {
    return [];
  }

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT json FROM ${tableName} WHERE id IN (${placeholders})`)
    .all(...normalizedIds);
  return parseJsonRows(rows);
}

function deleteByIds(db, tableName, columnName, ids) {
  const normalizedIds = Array.from(
    new Set((Array.isArray(ids) ? ids : []).map((id) => normalizeText(id)).filter(Boolean))
  );

  if (!normalizedIds.length) {
    return 0;
  }

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const result = db
    .prepare(`DELETE FROM ${tableName} WHERE ${columnName} IN (${placeholders})`)
    .run(...normalizedIds);
  return Number(result?.changes || 0);
}

function normalizeText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function createMigrationStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

module.exports = {
  BACKUP_DIRNAME,
  COLLECTION_FILE_TO_TABLE,
  DB_FILENAME,
  TABLES,
  createSqliteStore,
};
