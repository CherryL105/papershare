const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { createHttpBodyHelpers } = require("./http/request-utils");
const { createSpeechMutationReader } = require("./http/speech-mutation");
const { createRouter } = require("./router");
const { createServices } = require("./services");
const {
  convertElsevierXmlToHtml,
  fetchElsevierArticleSnapshotHtml,
  resolveElsevierApiKey,
} = require("./services/papers-service");
const { TABLES, createSqliteStore } = require("./storage/sqlite-store");
const {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
} = require("../../shared/papershare-shared");
const {
  formatLimitInMb,
  resolveAttachmentDescriptor,
  sanitizeAttachmentName,
} = require("./utils/attachment-utils");
const { createCorsHelpers } = require("./utils/cors");
const { enforceSnapshotArticleImagePolicy } = require("./utils/html-sanitizer");
const { HttpError } = require("./utils/http-error");
const {
  createAnnotationId,
  createAttachmentId,
  createDiscussionId,
  createPaperId,
} = require("./utils/id-factory");
const { MIME_TYPE_BY_EXTENSION } = require("./utils/mime-types");
const { createRecordNormalizers } = require("./utils/record-normalizers");
const { loadRuntimeConfig } = require("./utils/runtime-config");
const { createStoragePathUtils } = require("./utils/storage-path-utils");

const HOST = "0.0.0.0";
const MAX_REQUEST_BODY_BYTES = 25 * 1024 * 1024;
const ROOT_DIR = path.resolve(__dirname, "../..");
const CLIENT_DIST_DIR = path.join(ROOT_DIR, "dist");
const SESSION_COOKIE_NAME = "papershare_session";
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=300, must-revalidate";
const STATIC_HASHED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_HTML_CACHE_CONTROL = "no-cache";
const { allowedOrigins: ALLOWED_ORIGINS, port: PORT, storageDir: STORAGE_DIR } =
  loadRuntimeConfig({
    rootDir: ROOT_DIR,
  });
const HTML_DIR = path.join(STORAGE_DIR, "html");
const ATTACHMENTS_DIR = path.join(STORAGE_DIR, "attachments");
const PAPERS_FILE = path.join(STORAGE_DIR, "papers.json");
const ANNOTATIONS_FILE = path.join(STORAGE_DIR, "annotations.json");
const DISCUSSIONS_FILE = path.join(STORAGE_DIR, "discussions.json");
const USERS_FILE = path.join(STORAGE_DIR, "users.json");
const SESSIONS_FILE = path.join(STORAGE_DIR, "sessions.json");
const SQLITE_STORE = createSqliteStore({
  storageDir: STORAGE_DIR,
  jsonFilePaths: {
    [TABLES.PAPERS]: PAPERS_FILE,
    [TABLES.ANNOTATIONS]: ANNOTATIONS_FILE,
    [TABLES.DISCUSSIONS]: DISCUSSIONS_FILE,
    [TABLES.USERS]: USERS_FILE,
    [TABLES.SESSIONS]: SESSIONS_FILE,
  },
});
const HTTP_BODY_HELPERS = createHttpBodyHelpers({
  maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
});
const STORAGE_PATH_UTILS = createStoragePathUtils({
  HttpError,
  pathModule: path,
  storageDir: STORAGE_DIR,
});
const RECORD_NORMALIZERS = createRecordNormalizers({
  buildPrivateStorageUrl: STORAGE_PATH_UTILS.buildPrivateStorageUrl,
  normalizeStorageRecordPath: STORAGE_PATH_UTILS.normalizeStorageRecordPath,
});
const CORS_HELPERS = createCorsHelpers({
  allowedOrigins: ALLOWED_ORIGINS,
});
const SPEECH_MUTATION_READER = createSpeechMutationReader({
  formatLimitInMb,
  maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
  maxAttachmentCount: MAX_ATTACHMENT_COUNT,
  maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
  normalizeAttachmentRecord: RECORD_NORMALIZERS.normalizeAttachmentRecord,
  readRequestJson: HTTP_BODY_HELPERS.readRequestJson,
  sanitizeAttachmentName,
});

let appRouter = null;
let appServices = null;

const DEFAULT_USERS = [
  {
    id: "bootstrap-admin",
    username: "admin",
    role: "admin",
    passwordEnvVar: "PAPERSHARE_BOOTSTRAP_ADMIN_PASSWORD",
    createdAt: "2026-04-13T00:00:00.000Z",
  },
];

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start server.", error);
    process.exit(1);
  });
}

async function start() {
  await ensureStorageFiles();
  const server = createHttpServer();

  await new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      console.log(`PaperShare server running at http://${HOST}:${PORT}`);
      resolve();
    });
  });

  registerGracefulShutdown(server);
  return server;
}

function createHttpServer() {
  ensureAppRouter();

  return http.createServer(async (request, response) => {
    try {
      if (!appRouter) {
        throw new Error("App router has not been initialized");
      }

      await appRouter(request, response);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;

      if (statusCode >= 500) {
        console.error("Unhandled server error.", error);
      }

      HTTP_BODY_HELPERS.sendJson(response, statusCode, {
        error: error.message || "Internal server error",
      });
    }
  });
}

function ensureAppRouter() {
  if (!appRouter) {
    appRouter = createRouter(ensureAppServices());
  }

  return appRouter;
}

function ensureAppServices() {
  if (!appServices) {
    appServices = createAppServices();
  }

  return appServices;
}

async function ensureStorageFiles() {
  await ensureAppServices().system.ensureRuntimeReady(DEFAULT_USERS);
}

function createAppServices() {
  return createServices({
    collections: {
      ANNOTATIONS_FILE,
      DISCUSSIONS_FILE,
      PAPERS_FILE,
    },
    helpers: {
      attachments: {
        formatLimitInMb,
        resolveAttachmentDescriptor,
        sanitizeAttachmentName,
      },
      cors: CORS_HELPERS,
      http: {
        readRequestJson: HTTP_BODY_HELPERS.readRequestJson,
        readSpeechMutationBody: SPEECH_MUTATION_READER.readSpeechMutationBody,
        sendJson: HTTP_BODY_HELPERS.sendJson,
      },
      ids: {
        createAnnotationId,
        createAttachmentId,
        createDiscussionId,
        createPaperId,
      },
      normalizers: RECORD_NORMALIZERS,
      snapshots: {
        enforceSnapshotArticleImagePolicy,
      },
      storagePaths: {
        normalizeStorageRecordPath: STORAGE_PATH_UTILS.normalizeStorageRecordPath,
        resolveStorageAbsolutePath: STORAGE_PATH_UTILS.resolveStorageAbsolutePath,
      },
    },
    limits: {
      MAX_ATTACHMENT_BYTES,
      MAX_ATTACHMENT_COUNT,
      MAX_TOTAL_ATTACHMENT_BYTES,
    },
    paths: {
      ATTACHMENTS_DIR,
      CLIENT_DIST_DIR,
      HTML_DIR,
      STORAGE_DIR,
    },
    platform: {
      fs,
      HttpError,
      path,
      store: SQLITE_STORE,
    },
    runtime: {
      PORT,
      SESSION_COOKIE_NAME,
    },
    staticAssets: {
      MIME_TYPE_BY_EXTENSION,
      STATIC_ASSET_CACHE_CONTROL,
      STATIC_HASHED_ASSET_CACHE_CONTROL,
      STATIC_HTML_CACHE_CONTROL,
    },
  });
}

function registerGracefulShutdown(server) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    try {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    } catch (error) {
      console.error(`Failed to close HTTP server during ${signal}.`, error);
    }

    try {
      await SQLITE_STORE.close();
    } catch (error) {
      console.error(`Failed to close SQLite store during ${signal}.`, error);
    }

    process.exit(0);
  }

  ["SIGINT", "SIGTERM"].forEach((signal) => {
    process.once(signal, () => {
      shutdown(signal).catch((error) => {
        console.error(`Failed to shut down after ${signal}.`, error);
        process.exit(1);
      });
    });
  });
}

module.exports = {
  createHttpServer,
  ensureStorageFiles,
  start,
  convertElsevierXmlToHtml,
  fetchElsevierArticleSnapshotHtml,
  resolveElsevierApiKey,
};
