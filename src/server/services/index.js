const { createAssetsService } = require("./assets-service");
const { createAuthService } = require("./auth-service");
const { createDashboardService } = require("./dashboard-service");
const { createHttpService } = require("./http-service");
const { createPapersService } = require("./papers-service");
const { createSpeechService } = require("./speech-service");
const { createSystemService } = require("./system-service");
const { createUsersService } = require("./users-service");

function createServices(rawDeps) {
  const deps = normalizeServiceDeps(rawDeps);
  const {
    collections,
    helpers,
    limits,
    paths,
    platform,
    runtime: runtimeDeps,
    staticAssets,
  } = deps;
  const { attachments, cors, http: httpHelpers, ids, normalizers, snapshots, storagePaths } =
    helpers;
  const runtime = {
    PORT: runtimeDeps.PORT,
  };
  const http = createHttpService({
    applyCorsHeaders: cors.applyCorsHeaders,
    readRequestJson: httpHelpers.readRequestJson,
    readSpeechMutationBody: httpHelpers.readSpeechMutationBody,
    sendJson: httpHelpers.sendJson,
  });
  const auth = createAuthService({
    sessionCookieName: runtimeDeps.SESSION_COOKIE_NAME,
    store: platform.store,
  });
  const dashboard = createDashboardService({
    HttpError: platform.HttpError,
    normalizeAnnotationRecord: normalizers.normalizeAnnotationRecord,
    normalizeDiscussionRecord: normalizers.normalizeDiscussionRecord,
    normalizePaperRecord: normalizers.normalizePaperRecord,
    serializeUser: auth.serializeUser,
    store: platform.store,
  });
  const speech = createSpeechService({
    attachmentsDir: paths.ATTACHMENTS_DIR,
    createAnnotationId: ids.createAnnotationId,
    createAttachmentId: ids.createAttachmentId,
    createDiscussionId: ids.createDiscussionId,
    dashboardService: dashboard,
    formatLimitInMb: attachments.formatLimitInMb,
    fs: platform.fs,
    HttpError: platform.HttpError,
    maxAttachmentBytes: limits.MAX_ATTACHMENT_BYTES,
    maxAttachmentCount: limits.MAX_ATTACHMENT_COUNT,
    maxTotalAttachmentBytes: limits.MAX_TOTAL_ATTACHMENT_BYTES,
    normalizeAnnotationRecord: normalizers.normalizeAnnotationRecord,
    normalizeAttachmentRecord: normalizers.normalizeAttachmentRecord,
    normalizeAttachmentRecords: normalizers.normalizeAttachmentRecords,
    normalizeDiscussionRecord: normalizers.normalizeDiscussionRecord,
    path: platform.path,
    readSpeechMutationBody: httpHelpers.readSpeechMutationBody,
    resolveAttachmentDescriptor: attachments.resolveAttachmentDescriptor,
    resolveStorageAbsolutePath: storagePaths.resolveStorageAbsolutePath,
    sanitizeAttachmentName: attachments.sanitizeAttachmentName,
    store: platform.store,
  });
  const papers = createPapersService({
    createPaperId: ids.createPaperId,
    dashboardService: dashboard,
    deleteSpeechAttachmentsForRecords: speech.deleteAttachmentsForRecords,
    enforceSnapshotArticleImagePolicy: snapshots.enforceSnapshotArticleImagePolicy,
    fs: platform.fs,
    HttpError: platform.HttpError,
    normalizeAnnotationRecord: normalizers.normalizeAnnotationRecord,
    normalizeDiscussionRecord: normalizers.normalizeDiscussionRecord,
    normalizePaperRecord: normalizers.normalizePaperRecord,
    path: platform.path,
    storageDir: paths.STORAGE_DIR,
    store: platform.store,
  });
  const assets = createAssetsService({
    HttpError: platform.HttpError,
    attachmentsDir: paths.ATTACHMENTS_DIR,
    clientDistDir: paths.CLIENT_DIST_DIR,
    fetchElsevierObject: papers.fetchElsevierObject,
    fs: platform.fs,
    mimeTypeByExtension: staticAssets.MIME_TYPE_BY_EXTENSION,
    normalizeStorageRecordPath: storagePaths.normalizeStorageRecordPath,
    path: platform.path,
    resolveStorageAbsolutePath: storagePaths.resolveStorageAbsolutePath,
    sendJson: httpHelpers.sendJson,
    staticAssetCacheControl: staticAssets.STATIC_ASSET_CACHE_CONTROL,
    staticHashedAssetCacheControl: staticAssets.STATIC_HASHED_ASSET_CACHE_CONTROL,
    staticHtmlCacheControl: staticAssets.STATIC_HTML_CACHE_CONTROL,
  });
  const users = createUsersService({
    HttpError: platform.HttpError,
    authService: auth,
    dashboardService: dashboard,
    deleteSnapshotByPath: papers.deleteSnapshotByPath,
    deleteSpeechAttachmentsForRecords: speech.deleteAttachmentsForRecords,
    normalizeAnnotationRecord: normalizers.normalizeAnnotationRecord,
    normalizeDiscussionRecord: normalizers.normalizeDiscussionRecord,
    normalizePaperRecord: normalizers.normalizePaperRecord,
    store: platform.store,
  });
  const system = createSystemService({
    assetsService: assets,
    attachmentsDir: paths.ATTACHMENTS_DIR,
    collectionFiles: {
      annotations: collections.ANNOTATIONS_FILE,
      discussions: collections.DISCUSSIONS_FILE,
      papers: collections.PAPERS_FILE,
    },
    fs: platform.fs,
    htmlDir: paths.HTML_DIR,
    storageDir: paths.STORAGE_DIR,
    store: platform.store,
    usersService: users,
  });

  return {
    assets,
    auth,
    dashboard,
    http,
    papers,
    runtime,
    speech,
    system,
    users,
  };
}

function normalizeServiceDeps(deps) {
  if (deps?.helpers) {
    return deps;
  }

  return {
    collections: {
      ANNOTATIONS_FILE: deps.ANNOTATIONS_FILE,
      DISCUSSIONS_FILE: deps.DISCUSSIONS_FILE,
      PAPERS_FILE: deps.PAPERS_FILE,
    },
    helpers: {
      attachments: {
        formatLimitInMb: deps.formatLimitInMb,
        resolveAttachmentDescriptor: deps.resolveAttachmentDescriptor,
        sanitizeAttachmentName: deps.sanitizeAttachmentName,
      },
      cors: {
        applyCorsHeaders: deps.applyCorsHeaders,
      },
      http: {
        readRequestJson: deps.readRequestJson,
        readSpeechMutationBody: deps.readSpeechMutationBody,
        sendJson: deps.sendJson,
      },
      ids: {
        createAnnotationId: deps.createAnnotationId,
        createAttachmentId: deps.createAttachmentId,
        createDiscussionId: deps.createDiscussionId,
        createPaperId: deps.createPaperId,
      },
      normalizers: {
        normalizeAnnotationRecord: deps.normalizeAnnotationRecord,
        normalizeAttachmentRecord: deps.normalizeAttachmentRecord,
        normalizeAttachmentRecords: deps.normalizeAttachmentRecords,
        normalizeDiscussionRecord: deps.normalizeDiscussionRecord,
        normalizePaperRecord: deps.normalizePaperRecord,
      },
      snapshots: {
        enforceSnapshotArticleImagePolicy: deps.enforceSnapshotArticleImagePolicy,
      },
      storagePaths: {
        normalizeStorageRecordPath: deps.normalizeStorageRecordPath,
        resolveStorageAbsolutePath: deps.resolveStorageAbsolutePath,
      },
    },
    limits: {
      MAX_ATTACHMENT_BYTES: deps.MAX_ATTACHMENT_BYTES,
      MAX_ATTACHMENT_COUNT: deps.MAX_ATTACHMENT_COUNT,
      MAX_TOTAL_ATTACHMENT_BYTES: deps.MAX_TOTAL_ATTACHMENT_BYTES,
    },
    paths: {
      ATTACHMENTS_DIR: deps.ATTACHMENTS_DIR,
      CLIENT_DIST_DIR: deps.CLIENT_DIST_DIR,
      HTML_DIR: deps.HTML_DIR,
      STORAGE_DIR: deps.STORAGE_DIR,
    },
    platform: {
      fs: deps.fs,
      HttpError: deps.HttpError,
      path: deps.path,
      store: deps.store,
    },
    runtime: {
      PORT: deps.PORT,
      SESSION_COOKIE_NAME: deps.SESSION_COOKIE_NAME,
    },
    staticAssets: {
      MIME_TYPE_BY_EXTENSION: deps.MIME_TYPE_BY_EXTENSION,
      STATIC_ASSET_CACHE_CONTROL: deps.STATIC_ASSET_CACHE_CONTROL,
      STATIC_HASHED_ASSET_CACHE_CONTROL: deps.STATIC_HASHED_ASSET_CACHE_CONTROL,
      STATIC_HTML_CACHE_CONTROL: deps.STATIC_HTML_CACHE_CONTROL,
    },
  };
}

module.exports = {
  createServices,
};
