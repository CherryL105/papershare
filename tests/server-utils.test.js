import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  resolveAttachmentCategory,
  resolveAttachmentDescriptor,
} = require("../src/server/utils/attachment-utils");
const { enforceSnapshotArticleImagePolicy } = require("../src/server/utils/html-sanitizer");
const { createRecordNormalizers } = require("../src/server/utils/record-normalizers");
const {
  loadEnvFile,
  parseEnvLine,
  resolveStorageDirectory,
} = require("../src/server/utils/runtime-config");
const { createStoragePathUtils } = require("../src/server/utils/storage-path-utils");
const { extractMetadataFromHtml } = require("../src/server/services/papers-service");

const ENV_KEYS = [
  "PAPERSHARE_UTILS_TEST_EXISTING",
  "PAPERSHARE_UTILS_TEST_QUOTED",
  "PAPERSHARE_UTILS_TEST_STORAGE",
];

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
});

describe("server utility modules", () => {
  it("parses env lines with exports, quotes, and inline comments", () => {
    expect(parseEnvLine('export PAPERSHARE_UTILS_TEST_QUOTED="hello\\nworld"')).toEqual({
      key: "PAPERSHARE_UTILS_TEST_QUOTED",
      value: "hello\nworld",
    });
    expect(parseEnvLine("PAPERSHARE_UTILS_TEST_STORAGE=relative/storage # keep local")).toEqual({
      key: "PAPERSHARE_UTILS_TEST_STORAGE",
      value: "relative/storage",
    });
    expect(parseEnvLine("# comment only")).toBeNull();
  });

  it("loads env files without overwriting existing variables", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "papershare-utils-"));
    const envPath = path.join(tempDir, ".env");

    await fs.writeFile(
      envPath,
      [
        'PAPERSHARE_UTILS_TEST_QUOTED="line\\nvalue"',
        "PAPERSHARE_UTILS_TEST_STORAGE=relative/storage",
        "PAPERSHARE_UTILS_TEST_EXISTING=from-file",
      ].join("\n")
    );

    process.env.PAPERSHARE_UTILS_TEST_EXISTING = "keep-existing";

    try {
      loadEnvFile(envPath);

      expect(process.env.PAPERSHARE_UTILS_TEST_QUOTED).toBe("line\nvalue");
      expect(process.env.PAPERSHARE_UTILS_TEST_STORAGE).toBe("relative/storage");
      expect(process.env.PAPERSHARE_UTILS_TEST_EXISTING).toBe("keep-existing");
    } finally {
      await fs.rm(tempDir, { force: true, recursive: true });
    }
  });

  it("resolves storage directories and rejects traversal record paths", () => {
    class TestHttpError extends Error {
      constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
      }
    }

    const storageDir = resolveStorageDirectory("/srv/papershare", "local/storage");
    const storagePaths = createStoragePathUtils({
      HttpError: TestHttpError,
      storageDir,
    });

    expect(storageDir).toBe(path.resolve("/srv/papershare", "local/storage"));
    expect(storagePaths.normalizeStorageRecordPath("/attachments/paper/figure.png")).toBe(
      "attachments/paper/figure.png"
    );

    try {
      storagePaths.normalizeStorageRecordPath("../secrets.txt");
      throw new Error("Expected traversal path to throw");
    } catch (error) {
      expect(error.message).toBe("存储路径不合法");
      expect(error.statusCode).toBe(400);
    }
  });

  it("derives attachment descriptors and categories from file names and MIME types", () => {
    expect(resolveAttachmentDescriptor("table.csv", "")).toEqual({
      category: "table",
      extension: ".csv",
      mimeType: "text/csv; charset=utf-8",
    });
    expect(resolveAttachmentDescriptor("figure", "image/png")).toEqual({
      category: "image",
      extension: ".png",
      mimeType: "image/png",
    });
    expect(resolveAttachmentCategory(".xlsx", "")).toBe("table");
    expect(() => resolveAttachmentDescriptor("notes.txt", "text/plain")).toThrow(
      "仅支持上传图片或表格文件（PNG/JPG/GIF/WEBP/BMP/CSV/TSV/XLS/XLSX/ODS）"
    );
  });

  it("normalizes stored records with stable attachment URLs and root ids", () => {
    class TestHttpError extends Error {
      constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
      }
    }

    const storagePaths = createStoragePathUtils({
      HttpError: TestHttpError,
      storageDir: "/tmp/papershare-storage",
    });
    const normalizers = createRecordNormalizers({
      buildPrivateStorageUrl: storagePaths.buildPrivateStorageUrl,
      normalizeStorageRecordPath: storagePaths.normalizeStorageRecordPath,
    });

    const attachment = normalizers.normalizeAttachmentRecord({
      storage_path: "attachments/folder/figure.png",
      original_name: " ../unsafe?.png ",
      mime_type: "IMAGE/PNG",
      size_bytes: 42,
    });
    const annotation = normalizers.normalizeAnnotationRecord({
      id: "annotation-1",
      paperId: "paper-1",
      note: " note ",
      exact: "quoted text",
      attachments: [attachment],
    });
    const paper = normalizers.normalizePaperRecord({
      id: "paper-1",
      sourceUrl: "https://example.org/paper",
      title: "  A &amp; B  ",
      authors: " Ada&nbsp;Lovelace ",
      journal: " Journal &amp; Co ",
      abstract: "  Summary &amp; notes ",
      keywords: "alpha, beta；alpha",
    });

    expect(attachment).toEqual(
      expect.objectContaining({
        original_name: "unsafe_.png",
        extension: ".png",
        mime_type: "image/png",
        url: "/api/storage/attachments/folder/figure.png",
      })
    );
    expect(annotation.root_annotation_id).toBe("annotation-1");
    expect(annotation.attachments[0].url).toBe("/api/storage/attachments/folder/figure.png");
    expect(paper).toEqual(
      expect.objectContaining({
        title: "A & B",
        authors: "Ada Lovelace",
        journal: "Journal & Co",
        abstract: "Summary & notes",
        keywords: ["alpha", "beta"],
      })
    );
  });

  it("strips article images and background images for non-supported sources", () => {
    const sanitized = enforceSnapshotArticleImagePolicy(
      `<!doctype html>
      <html>
        <head>
          <meta property="og:image" content="https://example.org/cover.png" />
          <link rel="icon" href="/favicon.ico" />
        </head>
        <body>
          <picture><img src="/figure.png" alt="figure" /></picture>
          <div style="color:red; background-image:url('/bg.png');">content</div>
          <img src="/standalone.png" alt="standalone" />
        </body>
      </html>`,
      "https://example.org/paper"
    );

    expect(sanitized).not.toContain("<img");
    expect(sanitized).not.toContain("og:image");
    expect(sanitized).not.toContain("background-image");
    expect(sanitized).toContain("color:red");
  });

  it("reuses shared text utilities when extracting paper metadata", () => {
    const metadata = extractMetadataFromHtml(
      `<!doctype html>
      <html>
        <head>
          <meta name="citation_title" content=" A &amp; B " />
          <meta name="citation_author" content=" Ada&nbsp;Lovelace " />
          <meta name="citation_author" content=" Grace Hopper " />
          <meta name="citation_journal_title" content=" Journal &amp; Co " />
          <meta name="citation_abstract" content=" Abstract &amp; summary " />
          <meta name="keywords" content=" alpha, beta；alpha " />
        </head>
        <body></body>
      </html>`,
      "https://example.org/paper"
    );

    expect(metadata).toEqual({
      title: "A & B",
      authors: "Ada Lovelace, Grace Hopper",
      journal: "Journal & Co",
      published: "",
      abstract: "Abstract & summary",
      keywords: ["alpha", "beta"],
    });
  });
});
