import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_MODULE_CACHE_FRAGMENT = `${path.sep}src${path.sep}server${path.sep}`;

let builtClient = false;

async function createStorageDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "papershare-test-"));
}

function seedLegacySqliteWithoutSpeechCount(storageDir) {
  const db = new Database(path.join(storageDir, "papershare.sqlite"));

  db.exec(`
    CREATE TABLE papers (
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

    CREATE TABLE annotations (
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

    CREATE TABLE discussions (
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
  `);

  const paper = {
    id: "paper-legacy-sqlite",
    sourceUrl: "https://example.org/legacy-sqlite",
    title: "Legacy SQLite Paper",
    created_by_user_id: "bootstrap-admin",
    created_by_username: "admin",
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
    fetchedAt: "2026-04-15T00:00:00.000Z",
    snapshotPath: "html/legacy-sqlite.html",
  };
  const annotation = {
    id: "annotation-legacy-sqlite",
    paperId: paper.id,
    note: "Legacy sqlite annotation",
    exact: "Legacy",
    prefix: "",
    suffix: "",
    target_scope: "body",
    start_offset: 0,
    end_offset: 6,
    created_by_user_id: "bootstrap-admin",
    created_by_username: "admin",
    created_at: "2026-04-15T00:01:00.000Z",
    parent_annotation_id: "",
    root_annotation_id: "",
    attachments: [],
  };
  const discussion = {
    id: "discussion-legacy-sqlite",
    paperId: paper.id,
    note: "Legacy sqlite discussion",
    created_by_user_id: "bootstrap-admin",
    created_by_username: "admin",
    created_at: "2026-04-15T00:02:00.000Z",
    parent_discussion_id: "",
    root_discussion_id: "",
    attachments: [],
  };

  db.prepare(`
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    paper.id,
    paper.sourceUrl,
    paper.created_by_user_id,
    paper.created_by_username,
    paper.createdAt,
    paper.updatedAt,
    paper.fetchedAt,
    paper.snapshotPath,
    paper.title,
    "",
    "",
    JSON.stringify(paper)
  );
  db.prepare(`
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    annotation.id,
    annotation.paperId,
    annotation.parent_annotation_id,
    annotation.root_annotation_id,
    annotation.created_by_user_id,
    annotation.created_by_username,
    annotation.created_at,
    "[]",
    JSON.stringify(annotation)
  );
  db.prepare(`
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    discussion.id,
    discussion.paperId,
    discussion.parent_discussion_id,
    discussion.root_discussion_id,
    discussion.created_by_user_id,
    discussion.created_by_username,
    discussion.created_at,
    "[]",
    JSON.stringify(discussion)
  );

  db.close();
}

function clearServerModules() {
  Object.keys(require.cache).forEach((cacheKey) => {
    if (cacheKey.includes(SERVER_MODULE_CACHE_FRAGMENT) || cacheKey.endsWith(`${path.sep}server.js`)) {
      delete require.cache[cacheKey];
    }
  });
}

async function loadCoreForStorage(storageDir, extraEnv = {}) {
  process.env.PAPERSHARE_STORAGE_DIR = storageDir;
  delete process.env.PORT;
  delete process.env.PAPERSHARE_ALLOWED_ORIGINS;
  Object.entries(extraEnv).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      delete process.env[key];
      return;
    }

    process.env[key] = String(value);
  });
  clearServerModules();
  const core = require("../src/server/core");
  await core.ensureStorageFiles();
  return core;
}

function createLegacyPasswordHash(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function createImportHtml(title, bodyText) {
  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <meta name="citation_title" content="${title}" />
    </head>
    <body>
      <article>
        <h1>${title}</h1>
        <p>${bodyText}</p>
      </article>
    </body>
  </html>`;
}

function createPublisherHtml({ title, authors, journal, abstract, bodyHtml, extraHead = "" }) {
  const authorMetaTags = authors
    .map((author) => `<meta name="citation_author" content="${author}" />`)
    .join("\n      ");

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <meta property="og:title" content="${title}" />
      <meta name="citation_title" content="${title}" />
      ${authorMetaTags}
      <meta name="citation_journal_title" content="${journal}" />
      <meta name="citation_publication_date" content="2026-04-15" />
      <meta name="citation_abstract" content="${abstract}" />
      <meta name="description" content="${abstract}" />
      ${extraHead}
    </head>
    <body>
      <main>
        <article>
          <h1>${title}</h1>
          ${bodyHtml}
        </article>
      </main>
    </body>
  </html>`;
}

function createNatureHtml() {
  return createPublisherHtml({
    title: "Nature Linked Paper",
    authors: ["Ada Nature", "Ben Nature"],
    journal: "Nature",
    abstract: "Nature abstract for linked import.",
    extraHead: '<meta name="citation_fulltext_html_url" content="https://www.nature.com/articles/test" />',
    bodyHtml: `
      <section class="c-article-body">
        <p>Nature body paragraph for linked import.</p>
      </section>
    `,
  });
}

function createWileyHtml() {
  return createPublisherHtml({
    title: "Wiley Imported Paper",
    authors: ["Willa Wiley", "Robin Review"],
    journal: "Wiley Interdisciplinary Reviews",
    abstract: "Wiley abstract for HTML import.",
    extraHead: '<meta name="citation_fulltext_html_url" content="https://onlinelibrary.wiley.com/doi/full/test" />',
    bodyHtml: `
      <section class="article__body">
        <h2>Abstract</h2>
        <p>Wiley body paragraph for imported HTML snapshots.</p>
      </section>
    `,
  });
}

function createScienceHtml() {
  return createPublisherHtml({
    title: "Science Imported Paper",
    authors: ["Sam Science", "Dana Discovery"],
    journal: "Science",
    abstract: "Science abstract for HTML import.",
    extraHead: '<meta name="citation_fulltext_html_url" content="https://www.science.org/doi/full/test" />',
    bodyHtml: `
      <section class="article-section article-section__full">
        <div class="abstract-group">
          <p>Science body paragraph for imported HTML snapshots.</p>
        </div>
      </section>
    `,
  });
}

function createElsevierFullTextXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <full-text-retrieval-response
    xmlns="http://www.elsevier.com/xml/svapi/article/dtd"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/"
    xmlns:dcterms="http://purl.org/dc/terms/"
    xmlns:ce="http://www.elsevier.com/xml/common/dtd"
    xmlns:ja="http://www.elsevier.com/xml/ja/dtd"
  >
    <coredata>
      <dc:title>Elsevier API Paper</dc:title>
      <dc:creator>Alice Elsevier</dc:creator>
      <dc:creator>Bob API</dc:creator>
      <dc:description>Elsevier abstract text.</dc:description>
      <prism:publicationName>Journal of Testing</prism:publicationName>
      <prism:doi>10.1016/j.test.2026.01.001</prism:doi>
      <prism:coverDate>2026-01-01</prism:coverDate>
      <dcterms:subject>Cell biology</dcterms:subject>
    </coredata>
    <article>
      <body>
        <ce:sections>
          <ce:section>
            <ce:section-title>Introduction</ce:section-title>
            <ce:para>Elsevier body content from API XML.</ce:para>
          </ce:section>
        </ce:sections>
      </body>
      <tail>
        <ce:bibliography>
          <ce:section-title>References</ce:section-title>
          <ce:bib-reference>
            <ce:label>[1]</ce:label>
            <ce:textref>Reference entry.</ce:textref>
          </ce:bib-reference>
        </ce:bibliography>
      </tail>
    </article>
  </full-text-retrieval-response>`;
}

function mockFetchResponse(body, options = {}) {
  return new Response(body, {
    status: options.status || 200,
    headers: options.headers || {
      "content-type": "text/html; charset=utf-8",
    },
  });
}

function mockFetchSequence(...responses) {
  const fetchMock = vi.spyOn(globalThis, "fetch");

  responses.forEach((responseConfig) => {
    fetchMock.mockResolvedValueOnce(
      responseConfig instanceof Response
        ? responseConfig
        : mockFetchResponse(responseConfig.body || "", {
            status: responseConfig.status,
            headers: responseConfig.headers,
          })
    );
  });

  return fetchMock;
}

async function loginAs(agent, username = "admin", password = "1234") {
  const response = await agent.post("/api/auth/login").send({
    username,
    password,
  });

  expect(response.status).toBe(200);
  return response;
}

async function createMemberUser(agent, username, password = "pass1234") {
  const response = await agent.post("/api/users").send({
    username,
    password,
  });

  expect(response.status).toBe(201);
  return response.body.user;
}

async function importHtmlPaper(agent, sourceUrl, rawHtml) {
  const response = await agent.post("/api/papers/import-html").send({
    sourceUrl,
    rawHtml,
  });

  expect(response.status).toBe(201);
  return response.body;
}

async function createAnnotation(agent, paperId, overrides = {}) {
  const response = await agent.post(`/api/papers/${paperId}/annotations`).send({
    exact: "Paper",
    note: "Test annotation",
    prefix: "",
    suffix: "",
    target_scope: "body",
    start_offset: 0,
    end_offset: 5,
    ...overrides,
  });

  expect(response.status).toBe(201);
  return response.body;
}

async function createDiscussion(agent, paperId, overrides = {}) {
  const response = await agent.post(`/api/papers/${paperId}/discussions`).send({
    note: "Test discussion",
    ...overrides,
  });

  expect(response.status).toBe(201);
  return response.body;
}

async function createAnnotationReply(agent, annotationId, overrides = {}) {
  const response = await agent.post(`/api/annotations/${annotationId}/replies`).send({
    note: "Test annotation reply",
    ...overrides,
  });

  expect(response.status).toBe(201);
  return response.body;
}

async function createDiscussionReply(agent, discussionId, overrides = {}) {
  const response = await agent.post(`/api/discussions/${discussionId}/replies`).send({
    note: "Test discussion reply",
    ...overrides,
  });

  expect(response.status).toBe(201);
  return response.body;
}

async function postMultipartAttachment(agent, targetPath, options = {}) {
  const {
    fields = {},
    filename = "attachment.csv",
    content = "col1,col2\n1,2\n",
    contentType = "text/csv",
  } = options;

  let requestBuilder = agent.post(targetPath);

  Object.entries(fields).forEach(([fieldName, value]) => {
    if (value !== undefined && value !== null) {
      requestBuilder = requestBuilder.field(fieldName, String(value));
    }
  });

  return requestBuilder.attach("attachments", Buffer.from(content, "utf8"), {
    contentType,
    filename,
  });
}

async function getPaperContent(agent, paperId) {
  const response = await agent.get(`/api/papers/${paperId}/content`);

  expect(response.status).toBe(200);
  return response.body.rawHtml;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

beforeAll(() => {
  if (!builtClient) {
    execFileSync("npm", ["run", "build"], {
      cwd: ROOT_DIR,
      stdio: "pipe",
    });
    builtClient = true;
  }
});

afterEach(() => {
  delete process.env.PAPERSHARE_STORAGE_DIR;
  delete process.env.PAPERSHARE_ALLOWED_ORIGINS;
  delete process.env.ELSEVIER_API_KEY;
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  vi.restoreAllMocks();
});

describe("SQLite migration and API flows", () => {
  it("migrates legacy JSON to sqlite, creates backups, and rehashes legacy passwords on login", async () => {
    const storageDir = await createStorageDir();
    const createdAt = "2026-04-15T00:00:00.000Z";
    const legacyPaper = {
      id: "paper-legacy-json",
      sourceUrl: "https://example.org/legacy-json",
      title: "Legacy JSON Paper",
      created_by_user_id: "user-legacy",
      created_by_username: "legacy",
      createdAt,
      updatedAt: createdAt,
      fetchedAt: createdAt,
      snapshotPath: "html/legacy-json.html",
    };
    const legacyAnnotation = {
      id: "annotation-legacy-json",
      paperId: legacyPaper.id,
      note: "Legacy annotation",
      exact: "Legacy",
      prefix: "",
      suffix: "",
      target_scope: "body",
      start_offset: 0,
      end_offset: 6,
      created_by_user_id: "user-legacy",
      created_by_username: "legacy",
      created_at: "2026-04-15T00:01:00.000Z",
      parent_annotation_id: "",
      root_annotation_id: "",
      attachments: [],
    };
    const legacyDiscussion = {
      id: "discussion-legacy-json",
      paperId: legacyPaper.id,
      note: "Legacy discussion",
      created_by_user_id: "user-legacy",
      created_by_username: "legacy",
      created_at: "2026-04-15T00:02:00.000Z",
      parent_discussion_id: "",
      root_discussion_id: "",
      attachments: [],
    };

    await Promise.all([
      fs.writeFile(
        path.join(storageDir, "users.json"),
        JSON.stringify(
          [
            {
              id: "user-legacy",
              username: "legacy",
              role: "member",
              passwordHash: createLegacyPasswordHash("legacy-pass"),
              createdAt,
            },
          ],
          null,
          2
        ),
        "utf8"
      ),
      fs.writeFile(path.join(storageDir, "sessions.json"), "[]\n", "utf8"),
      fs.writeFile(path.join(storageDir, "papers.json"), JSON.stringify([legacyPaper], null, 2), "utf8"),
      fs.writeFile(
        path.join(storageDir, "annotations.json"),
        JSON.stringify([legacyAnnotation], null, 2),
        "utf8"
      ),
      fs.writeFile(
        path.join(storageDir, "discussions.json"),
        JSON.stringify([legacyDiscussion], null, 2),
        "utf8"
      ),
    ]);

    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const agent = request.agent(app);

    const loginResponse = await agent.post("/api/auth/login").send({
      username: "legacy",
      password: "legacy-pass",
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user.username).toBe("legacy");

    const backupRoot = path.join(storageDir, "migration-backups");
    const backupDirs = await fs.readdir(backupRoot);
    expect(backupDirs.length).toBe(1);

    const db = new Database(path.join(storageDir, "papershare.sqlite"), { readonly: true });
    const migratedUser = db
      .prepare("SELECT password_hash AS passwordHash FROM users WHERE username = ?")
      .get("legacy");
    const migratedPaper = db
      .prepare(`
        SELECT speech_count AS speechCount, latest_speech_at AS latestSpeechAt,
               latest_speaker_username AS latestSpeakerUsername, json
        FROM papers
        WHERE id = ?
      `)
      .get(legacyPaper.id);
    const migratedPaperJson = JSON.parse(migratedPaper.json);

    expect(migratedUser.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE username = ?").get("legacy").count
    ).toBe(1);
    expect(migratedPaper.speechCount).toBe(2);
    expect(migratedPaper.latestSpeechAt).toBe("2026-04-15T00:02:00.000Z");
    expect(migratedPaper.latestSpeakerUsername).toBe("legacy");
    expect(migratedPaperJson.speechCount).toBe(2);
    expect(migratedPaperJson.latestSpeechAt).toBe("2026-04-15T00:02:00.000Z");
    expect(migratedPaperJson.latestSpeakerUsername).toBe("legacy");
    db.close();

    const papersResponse = await agent.get("/api/papers");
    expect(papersResponse.status).toBe(200);
    expect(papersResponse.body[0].speechCount).toBe(2);
    expect(papersResponse.body[0].latestSpeechAt).toBe("2026-04-15T00:02:00.000Z");
    expect(papersResponse.body[0].latestSpeakerUsername).toBe("legacy");
  });

  it("backfills paper activity when upgrading an existing sqlite database", async () => {
    const storageDir = await createStorageDir();
    seedLegacySqliteWithoutSpeechCount(storageDir);

    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    const loginResponse = await admin.post("/api/auth/login").send({
      username: "admin",
      password: "1234",
    });
    expect(loginResponse.status).toBe(200);

    const db = new Database(path.join(storageDir, "papershare.sqlite"), { readonly: true });
    const columns = db
      .prepare("PRAGMA table_info(papers)")
      .all()
      .map((column) => column.name);
    const upgradedPaper = db
      .prepare(`
        SELECT speech_count AS speechCount, latest_speech_at AS latestSpeechAt,
               latest_speaker_username AS latestSpeakerUsername, json
        FROM papers
        WHERE id = ?
      `)
      .get("paper-legacy-sqlite");
    const upgradedPaperJson = JSON.parse(upgradedPaper.json);

    expect(columns).toContain("speech_count");
    expect(upgradedPaper.speechCount).toBe(2);
    expect(upgradedPaper.latestSpeechAt).toBe("2026-04-15T00:02:00.000Z");
    expect(upgradedPaper.latestSpeakerUsername).toBe("admin");
    expect(upgradedPaperJson.speechCount).toBe(2);
    db.close();

    const papersResponse = await admin.get("/api/papers");
    expect(papersResponse.status).toBe(200);
    expect(papersResponse.body).toHaveLength(1);
    expect(papersResponse.body[0].speechCount).toBe(2);
    expect(papersResponse.body[0].latestSpeechAt).toBe("2026-04-15T00:02:00.000Z");
    expect(papersResponse.body[0].latestSpeakerUsername).toBe("admin");
  });

  it("keeps the main collaboration flow working against sqlite-backed storage", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    const loginResponse = await admin.post("/api/auth/login").send({
      username: "admin",
      password: "1234",
    });

    expect(loginResponse.status).toBe(200);

    const createUserResponse = await admin.post("/api/users").send({
      username: "member1",
      password: "pass1234",
    });

    expect(createUserResponse.status).toBe(201);

    const member = request.agent(app);
    const memberLoginResponse = await member.post("/api/auth/login").send({
      username: "member1",
      password: "pass1234",
    });

    expect(memberLoginResponse.status).toBe(200);

    const homeResponse = await admin.get("/");
    expect(homeResponse.status).toBe(200);
    expect(homeResponse.text).toContain("Papershare 文章分享讨论");

    const importResponse = await admin.post("/api/papers/import-html").send({
      rawHtml: createImportHtml("A Test Paper", "Hello team discussion"),
      sourceUrl: "https://example.org/papers/1",
    });

    expect(importResponse.status).toBe(201);
    expect(importResponse.body.title).toContain("A Test Paper");

    const paperId = importResponse.body.id;

    const annotationResponse = await admin.post(`/api/papers/${paperId}/annotations`).send({
      exact: "Hello",
      note: "Admin annotation",
      prefix: "",
      suffix: "",
      target_scope: "body",
      start_offset: 0,
      end_offset: 5,
    });

    expect(annotationResponse.status).toBe(201);

    const discussionResponse = await admin.post(`/api/papers/${paperId}/discussions`).send({
      note: "Admin discussion",
    });

    expect(discussionResponse.status).toBe(201);

    const annotationReplyResponse = await member
      .post(`/api/annotations/${annotationResponse.body.id}/replies`)
      .send({
        note: "Member reply",
      });

    expect(annotationReplyResponse.status).toBe(201);

    const discussionReplyResponse = await member
      .post(`/api/discussions/${discussionResponse.body.id}/replies`)
      .send({
        note: "Member discussion reply",
      });

    expect(discussionReplyResponse.status).toBe(201);

    const dashboardResponse = await admin.get("/api/me/dashboard");
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.uploadedPapers).toHaveLength(1);
    expect(dashboardResponse.body.myAnnotations).toHaveLength(2);
    expect(dashboardResponse.body.repliesToMyAnnotations).toHaveLength(2);

    const papersResponse = await admin.get("/api/papers");
    expect(papersResponse.status).toBe(200);
    expect(papersResponse.body).toHaveLength(1);
    expect(papersResponse.body[0].speechCount).toBe(4);
    expect(papersResponse.body[0].latestSpeechAt).toBeTruthy();
    expect(papersResponse.body[0].latestSpeakerUsername).toBe("member1");

    const usersResponse = await admin.get("/api/users");
    expect(usersResponse.status).toBe(200);

    const adminStats = usersResponse.body.find((user) => user.username === "admin");
    const memberStats = usersResponse.body.find((user) => user.username === "member1");

    expect(adminStats.uploadedPaperCount).toBe(1);
    expect(adminStats.annotationCount).toBe(2);
    expect(memberStats.annotationCount).toBe(2);

    const statusResponse = await admin.get("/api/status");
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.paperCount).toBe(1);
    expect(statusResponse.body.annotationCount).toBe(2);
    expect(statusResponse.body.discussionCount).toBe(2);
  });

  it("rehashes newly created users with async scrypt and honors password changes", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await loginAs(admin);
    await createMemberUser(admin, "password-member", "old-pass");

    const member = request.agent(app);
    await loginAs(member, "password-member", "old-pass");

    const changePasswordResponse = await member.post("/api/me/password").send({
      currentPassword: "old-pass",
      nextPassword: "new-pass",
    });
    expect(changePasswordResponse.status).toBe(200);

    const oldPasswordLoginResponse = await request(app).post("/api/auth/login").send({
      username: "password-member",
      password: "old-pass",
    });
    expect(oldPasswordLoginResponse.status).toBe(401);

    const newPasswordLoginResponse = await request(app).post("/api/auth/login").send({
      username: "password-member",
      password: "new-pass",
    });
    expect(newPasswordLoginResponse.status).toBe(200);

    const db = new Database(path.join(storageDir, "papershare.sqlite"), { readonly: true });
    const updatedUser = db
      .prepare("SELECT password_hash AS passwordHash FROM users WHERE username = ?")
      .get("password-member");

    expect(updatedUser.passwordHash.startsWith("scrypt$")).toBe(true);
    db.close();
  });

  it("recomputes paper activity after username changes and speech deletions", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await loginAs(admin);
    await createMemberUser(admin, "rename-member", "rename-pass");

    const member = request.agent(app);
    await loginAs(member, "rename-member", "rename-pass");

    const importedPaper = await importHtmlPaper(
      admin,
      "https://example.org/papers/rename-activity",
      createImportHtml("Rename Activity Paper", "Delete and rename checks")
    );
    const discussion = await createDiscussion(admin, importedPaper.id, {
      note: "Admin discussion",
    });
    const reply = await createDiscussionReply(member, discussion.id, {
      note: "Member reply",
    });

    const beforeRenameResponse = await admin.get("/api/papers");
    expect(beforeRenameResponse.status).toBe(200);
    expect(beforeRenameResponse.body[0].speechCount).toBe(2);
    expect(beforeRenameResponse.body[0].latestSpeakerUsername).toBe("rename-member");

    const renameResponse = await member.post("/api/me/username").send({
      username: "renamed-member",
    });
    expect(renameResponse.status).toBe(200);
    expect(renameResponse.body.user.username).toBe("renamed-member");

    const afterRenameResponse = await admin.get("/api/papers");
    expect(afterRenameResponse.status).toBe(200);
    expect(afterRenameResponse.body[0].speechCount).toBe(2);
    expect(afterRenameResponse.body[0].latestSpeakerUsername).toBe("renamed-member");

    const deleteReplyResponse = await member.delete(`/api/discussions/${reply.id}`);
    expect(deleteReplyResponse.status).toBe(200);

    const afterReplyDeleteResponse = await admin.get("/api/papers");
    expect(afterReplyDeleteResponse.status).toBe(200);
    expect(afterReplyDeleteResponse.body[0].speechCount).toBe(1);
    expect(afterReplyDeleteResponse.body[0].latestSpeakerUsername).toBe("admin");

    const deleteDiscussionResponse = await admin.delete(`/api/discussions/${discussion.id}`);
    expect(deleteDiscussionResponse.status).toBe(200);

    const afterDiscussionDeleteResponse = await admin.get("/api/papers");
    expect(afterDiscussionDeleteResponse.status).toBe(200);
    expect(afterDiscussionDeleteResponse.body[0].speechCount).toBe(0);
    expect(afterDiscussionDeleteResponse.body[0].latestSpeechAt).toBe("");
    expect(afterDiscussionDeleteResponse.body[0].latestSpeakerUsername).toBe("");
  });

  it("enforces CORS allowlists, secure cookie attributes, and static cache headers", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir, {
      PAPERSHARE_ALLOWED_ORIGINS: "https://allowed.example",
    });
    const app = core.createHttpServer();

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .set("Origin", "https://allowed.example")
      .set("X-Forwarded-Proto", "https")
      .send({
        username: "admin",
        password: "1234",
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers["access-control-allow-origin"]).toBe("https://allowed.example");
    expect(loginResponse.headers["access-control-allow-credentials"]).toBe("true");
    expect(loginResponse.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(loginResponse.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect(loginResponse.headers["set-cookie"][0]).toContain("Secure");

    const blockedCorsResponse = await request(app)
      .options("/api/auth/me")
      .set("Origin", "https://blocked.example");

    expect(blockedCorsResponse.status).toBe(204);
    expect(blockedCorsResponse.headers["access-control-allow-origin"]).toBeUndefined();

    const homeResponse = await request(app).get("/");
    expect(homeResponse.status).toBe(200);
    expect(homeResponse.headers["cache-control"]).toBe("no-cache");

    const assetPath = homeResponse.text.match(/src=\"([^\"]*\/assets\/[^\"]+\.js)\"/)?.[1];
    expect(assetPath).toBeTruthy();

    const assetResponse = await request(app).get(assetPath);
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("accepts multipart annotation uploads through the streaming parser", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await admin.post("/api/auth/login").send({
      username: "admin",
      password: "1234",
    });

    const importResponse = await admin.post("/api/papers/import-html").send({
      rawHtml: createImportHtml("Multipart Paper", "Attachment body"),
      sourceUrl: "https://example.org/papers/multipart",
    });

    const paperId = importResponse.body.id;
    const annotationResponse = await admin
      .post(`/api/papers/${paperId}/annotations`)
      .field("exact", "Attachment")
      .field("note", "Multipart annotation")
      .field("prefix", "")
      .field("suffix", " body")
      .field("target_scope", "body")
      .field("start_offset", "0")
      .field("end_offset", "10")
      .attach("attachments", Buffer.from("col1,col2\n1,2\n", "utf8"), {
        contentType: "text/csv",
        filename: "table.csv",
      });

    expect(annotationResponse.status).toBe(201);
    expect(annotationResponse.body.attachments).toHaveLength(1);
    expect(annotationResponse.body.attachments[0].original_name).toBe("table.csv");
    expect(annotationResponse.body.attachments[0].url).toContain("/api/storage/");
  });

  it("imports Nature papers from source links by fetching HTML snapshots", async () => {
    const storageDir = await createStorageDir();
    const sourceUrl = "https://www.nature.com/articles/s41586-026-00001-1";
    const fetchMock = mockFetchSequence({
      body: createNatureHtml(),
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await loginAs(admin);

    const importResponse = await admin.post("/api/papers").send({
      sourceUrl,
    });

    expect(importResponse.status).toBe(201);
    expect(importResponse.body.title).toBe("Nature Linked Paper");
    expect(importResponse.body.authors).toContain("Ada Nature");
    expect(importResponse.body.journal).toBe("Nature");

    const rawHtml = await getPaperContent(admin, importResponse.body.id);
    expect(rawHtml).toContain("Nature body paragraph for linked import.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(sourceUrl);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("api.elsevier.com");
  });

  it("imports Elsevier papers from source links through the Full Text API", async () => {
    const storageDir = await createStorageDir();
    const sourceUrl = "https://www.sciencedirect.com/science/article/pii/S1234567890123456";
    const fetchMock = mockFetchSequence({
      body: createElsevierFullTextXml(),
      headers: {
        "content-type": "text/xml; charset=utf-8",
      },
    });
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await loginAs(admin);

    const importResponse = await admin.post("/api/papers").send({
      sourceUrl,
      elsevierApiKey: "test-api-key",
    });

    expect(importResponse.status).toBe(201);
    expect(importResponse.body.title).toBe("Elsevier API Paper");
    expect(importResponse.body.journal).toBe("Journal of Testing");
    expect(importResponse.body.abstract).toBe("Elsevier abstract text.");

    const rawHtml = await getPaperContent(admin, importResponse.body.id);
    expect(rawHtml).toContain("Imported From Elsevier Full Text API");
    expect(rawHtml).toContain("Elsevier body content from API XML.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "https://api.elsevier.com/content/article/pii/S1234567890123456"
    );
    expect(fetchMock.mock.calls[0][1].headers["X-ELS-APIKey"]).toBe("test-api-key");
  });

  for (const scenario of [
    {
      label: "Wiley",
      sourceUrl: "https://onlinelibrary.wiley.com/doi/full/10.1002/wcms.1234",
      html: createWileyHtml(),
      expectedTitle: "Wiley Imported Paper",
      expectedAuthor: "Willa Wiley",
      expectedJournal: "Wiley Interdisciplinary Reviews",
      expectedMarker: "Wiley body paragraph for imported HTML snapshots.",
    },
    {
      label: "Science",
      sourceUrl: "https://www.science.org/doi/10.1126/science.abcd1234",
      html: createScienceHtml(),
      expectedTitle: "Science Imported Paper",
      expectedAuthor: "Sam Science",
      expectedJournal: "Science",
      expectedMarker: "Science body paragraph for imported HTML snapshots.",
    },
  ]) {
    it(`imports ${scenario.label} HTML snapshots`, async () => {
      const storageDir = await createStorageDir();
      const core = await loadCoreForStorage(storageDir);
      const app = core.createHttpServer();
      const admin = request.agent(app);

      await loginAs(admin);

      const paper = await importHtmlPaper(admin, scenario.sourceUrl, scenario.html);
      expect(paper.title).toBe(scenario.expectedTitle);
      expect(paper.authors).toContain(scenario.expectedAuthor);
      expect(paper.journal).toBe(scenario.expectedJournal);

      const rawHtml = await getPaperContent(admin, paper.id);
      expect(rawHtml).toContain(scenario.expectedMarker);
      expect(rawHtml).toContain(scenario.expectedTitle);
    });
  }

  it("accepts multipart discussion attachments without a text note", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await loginAs(admin);

    const paper = await importHtmlPaper(
      admin,
      "https://example.org/papers/discussion-attachment",
      createImportHtml("Discussion Attachment Paper", "Discussion attachment body")
    );
    const discussionResponse = await postMultipartAttachment(
      admin,
      `/api/papers/${paper.id}/discussions`,
      {
        filename: "discussion-figure.png",
        content: "fake image bytes",
        contentType: "image/png",
      }
    );

    expect(discussionResponse.status).toBe(201);
    expect(discussionResponse.body.note).toBe("");
    expect(discussionResponse.body.attachments).toHaveLength(1);
    expect(discussionResponse.body.attachments[0].original_name).toBe("discussion-figure.png");
    expect(discussionResponse.body.attachments[0].url).toContain("/api/storage/");
  });

  it("accepts multipart annotation reply attachments without a text note", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await loginAs(admin);

    const paper = await importHtmlPaper(
      admin,
      "https://example.org/papers/annotation-reply-attachment",
      createImportHtml("Annotation Reply Paper", "Paper reply body")
    );
    const annotation = await createAnnotation(admin, paper.id);
    const replyResponse = await postMultipartAttachment(
      admin,
      `/api/annotations/${annotation.id}/replies`,
      {
        filename: "annotation-reply.csv",
        contentType: "text/csv",
      }
    );

    expect(replyResponse.status).toBe(201);
    expect(replyResponse.body.note).toBe("");
    expect(replyResponse.body.attachments).toHaveLength(1);
    expect(replyResponse.body.attachments[0].original_name).toBe("annotation-reply.csv");
    expect(replyResponse.body.attachments[0].url).toContain("/api/storage/");
  });

  it("accepts multipart discussion reply attachments without a text note", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await loginAs(admin);

    const paper = await importHtmlPaper(
      admin,
      "https://example.org/papers/discussion-reply-attachment",
      createImportHtml("Discussion Reply Paper", "Discussion reply body")
    );
    const discussion = await createDiscussion(admin, paper.id);
    const replyResponse = await postMultipartAttachment(
      admin,
      `/api/discussions/${discussion.id}/replies`,
      {
        filename: "discussion-reply.csv",
        contentType: "text/csv",
      }
    );

    expect(replyResponse.status).toBe(201);
    expect(replyResponse.body.note).toBe("");
    expect(replyResponse.body.attachments).toHaveLength(1);
    expect(replyResponse.body.attachments[0].original_name).toBe("discussion-reply.csv");
    expect(replyResponse.body.attachments[0].url).toContain("/api/storage/");
  });

  it("deletes users without purging their uploaded papers and discussion history", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await loginAs(admin);

    const retainedUser = await createMemberUser(admin, "retain-member", "retain-pass");
    const member = request.agent(app);

    await loginAs(member, "retain-member", "retain-pass");

    const paper = await importHtmlPaper(
      member,
      "https://example.org/papers/retained-history",
      createImportHtml("Retained History Paper", "Paper body for retained history")
    );
    const annotation = await createAnnotation(member, paper.id, {
      exact: "Paper",
      end_offset: 5,
    });
    const discussion = await createDiscussion(member, paper.id, {
      note: "Retained root discussion",
    });

    await createAnnotationReply(member, annotation.id, {
      note: "Retained annotation reply",
    });
    await createDiscussionReply(member, discussion.id, {
      note: "Retained discussion reply",
    });

    const deleteResponse = await admin.delete(`/api/users/${retainedUser.id}`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.deletedUserId).toBe(retainedUser.id);
    expect(deleteResponse.body.purgeContent).toBe(false);
    expect(deleteResponse.body.deletedContent).toBeNull();

    const usersResponse = await admin.get("/api/users");
    expect(usersResponse.status).toBe(200);
    expect(usersResponse.body.find((user) => user.id === retainedUser.id)).toBeUndefined();

    const reloginAgent = request.agent(app);
    const reloginResponse = await reloginAgent.post("/api/auth/login").send({
      username: "retain-member",
      password: "retain-pass",
    });
    expect(reloginResponse.status).toBe(401);

    const papersResponse = await admin.get("/api/papers");
    expect(papersResponse.status).toBe(200);
    expect(papersResponse.body).toHaveLength(1);
    expect(papersResponse.body[0].speechCount).toBe(4);

    const statusResponse = await admin.get("/api/status");
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.paperCount).toBe(1);
    expect(statusResponse.body.annotationCount).toBe(2);
    expect(statusResponse.body.discussionCount).toBe(2);

    const annotationsResponse = await admin.get(`/api/papers/${paper.id}/annotations`);
    expect(annotationsResponse.status).toBe(200);
    expect(annotationsResponse.body).toHaveLength(2);

    const discussionsResponse = await admin.get(`/api/papers/${paper.id}/discussions`);
    expect(discussionsResponse.status).toBe(200);
    expect(discussionsResponse.body).toHaveLength(2);
  });

  it("purges uploaded papers, speech records, snapshots, and attachments when deleting a user", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await loginAs(admin);

    const purgeUser = await createMemberUser(admin, "purge-member", "purge-pass");
    const member = request.agent(app);

    await loginAs(member, "purge-member", "purge-pass");

    const paper = await importHtmlPaper(
      member,
      "https://example.org/papers/purge-history",
      createImportHtml("Purge History Paper", "Paper body for purged history")
    );
    const snapshotAbsolutePath = path.join(storageDir, paper.snapshotPath);
    const annotationResponse = await postMultipartAttachment(
      member,
      `/api/papers/${paper.id}/annotations`,
      {
        fields: {
          exact: "Paper",
          note: "Purged annotation",
          prefix: "",
          suffix: "",
          target_scope: "body",
          start_offset: "0",
          end_offset: "5",
        },
        filename: "purged-annotation.csv",
      }
    );
    expect(annotationResponse.status).toBe(201);

    const discussionResponse = await postMultipartAttachment(
      member,
      `/api/papers/${paper.id}/discussions`,
      {
        fields: {
          note: "Purged discussion",
        },
        filename: "purged-discussion.png",
        content: "fake image bytes",
        contentType: "image/png",
      }
    );
    expect(discussionResponse.status).toBe(201);

    await createAnnotationReply(member, annotationResponse.body.id, {
      note: "Purged annotation reply",
    });
    await createDiscussionReply(member, discussionResponse.body.id, {
      note: "Purged discussion reply",
    });

    const annotationAttachmentAbsolutePath = path.join(
      storageDir,
      annotationResponse.body.attachments[0].storage_path
    );
    const discussionAttachmentAbsolutePath = path.join(
      storageDir,
      discussionResponse.body.attachments[0].storage_path
    );

    expect(await pathExists(snapshotAbsolutePath)).toBe(true);
    expect(await pathExists(annotationAttachmentAbsolutePath)).toBe(true);
    expect(await pathExists(discussionAttachmentAbsolutePath)).toBe(true);

    const deleteResponse = await admin.delete(`/api/users/${purgeUser.id}?purgeContent=1`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.deletedUserId).toBe(purgeUser.id);
    expect(deleteResponse.body.purgeContent).toBe(true);
    expect(deleteResponse.body.deletedContent).toEqual({
      paperCount: 1,
      annotationCount: 2,
      discussionCount: 2,
    });

    const reloginAgent = request.agent(app);
    const reloginResponse = await reloginAgent.post("/api/auth/login").send({
      username: "purge-member",
      password: "purge-pass",
    });
    expect(reloginResponse.status).toBe(401);

    const papersResponse = await admin.get("/api/papers");
    expect(papersResponse.status).toBe(200);
    expect(papersResponse.body).toHaveLength(0);

    const statusResponse = await admin.get("/api/status");
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.paperCount).toBe(0);
    expect(statusResponse.body.annotationCount).toBe(0);
    expect(statusResponse.body.discussionCount).toBe(0);

    expect(await pathExists(snapshotAbsolutePath)).toBe(false);
    expect(await pathExists(annotationAttachmentAbsolutePath)).toBe(false);
    expect(await pathExists(discussionAttachmentAbsolutePath)).toBe(false);
  });

  it("transfers admin privileges across existing sessions and fresh logins", async () => {
    const storageDir = await createStorageDir();
    const core = await loadCoreForStorage(storageDir);
    const app = core.createHttpServer();
    const admin = request.agent(app);

    await loginAs(admin);

    const promotedUser = await createMemberUser(admin, "next-admin", "next-admin-pass");
    const member = request.agent(app);

    await loginAs(member, "next-admin", "next-admin-pass");

    const transferResponse = await admin.post(`/api/users/${promotedUser.id}/transfer-admin`);

    expect(transferResponse.status).toBe(200);
    expect(transferResponse.body.currentUser.role).toBe("member");
    expect(transferResponse.body.targetUser.role).toBe("admin");

    const oldAdminMeResponse = await admin.get("/api/auth/me");
    expect(oldAdminMeResponse.status).toBe(200);
    expect(oldAdminMeResponse.body.authenticated).toBe(true);
    expect(oldAdminMeResponse.body.user.role).toBe("member");

    const oldAdminCreateUserResponse = await admin.post("/api/users").send({
      username: "blocked-after-transfer",
      password: "pass1234",
    });
    expect(oldAdminCreateUserResponse.status).toBe(403);

    const oldAdminNormalRouteResponse = await admin.get("/api/papers");
    expect(oldAdminNormalRouteResponse.status).toBe(200);

    const newAdminMeResponse = await member.get("/api/auth/me");
    expect(newAdminMeResponse.status).toBe(200);
    expect(newAdminMeResponse.body.authenticated).toBe(true);
    expect(newAdminMeResponse.body.user.role).toBe("admin");

    const newAdminCreateUserResponse = await member.post("/api/users").send({
      username: "created-from-existing-session",
      password: "pass1234",
    });
    expect(newAdminCreateUserResponse.status).toBe(201);

    const oldAdminRelogin = request.agent(app);
    await loginAs(oldAdminRelogin, "admin", "1234");

    const oldAdminReloginMeResponse = await oldAdminRelogin.get("/api/auth/me");
    expect(oldAdminReloginMeResponse.status).toBe(200);
    expect(oldAdminReloginMeResponse.body.user.role).toBe("member");

    const oldAdminReloginCreateResponse = await oldAdminRelogin.post("/api/users").send({
      username: "blocked-after-relogin",
      password: "pass1234",
    });
    expect(oldAdminReloginCreateResponse.status).toBe(403);

    const newAdminRelogin = request.agent(app);
    await loginAs(newAdminRelogin, "next-admin", "next-admin-pass");

    const newAdminReloginMeResponse = await newAdminRelogin.get("/api/auth/me");
    expect(newAdminReloginMeResponse.status).toBe(200);
    expect(newAdminReloginMeResponse.body.user.role).toBe("admin");

    const newAdminReloginCreateResponse = await newAdminRelogin.post("/api/users").send({
      username: "created-after-relogin",
      password: "pass1234",
    });
    expect(newAdminReloginCreateResponse.status).toBe(201);
  });
});
