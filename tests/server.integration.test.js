import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_MODULE_CACHE_FRAGMENT = `${path.sep}src${path.sep}server${path.sep}`;

let builtClient = false;

async function createStorageDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "papershare-test-"));
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
});

describe("SQLite migration and API flows", () => {
  it("migrates legacy JSON to sqlite, creates backups, and rehashes legacy passwords on login", async () => {
    const storageDir = await createStorageDir();
    const createdAt = "2026-04-15T00:00:00.000Z";

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
      fs.writeFile(path.join(storageDir, "papers.json"), "[]\n", "utf8"),
      fs.writeFile(path.join(storageDir, "annotations.json"), "[]\n", "utf8"),
      fs.writeFile(path.join(storageDir, "discussions.json"), "[]\n", "utf8"),
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

    expect(migratedUser.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE username = ?").get("legacy").count
    ).toBe(1);
    db.close();
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
});
