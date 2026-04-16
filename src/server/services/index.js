const { createAssetsService } = require("./assets-service");
const { createAuthService } = require("./auth-service");
const { createDashboardService } = require("./dashboard-service");
const { createHttpService } = require("./http-service");
const { createPapersService } = require("./papers-service");
const { createSpeechService } = require("./speech-service");
const { createSystemService } = require("./system-service");
const { createUsersService } = require("./users-service");

function createServices(deps) {
  const runtime = {
    PORT: deps.PORT,
  };
  const http = createHttpService({
    applyCorsHeaders: deps.applyCorsHeaders,
    readRequestJson: deps.readRequestJson,
    readSpeechMutationBody: deps.readSpeechMutationBody,
    sendJson: deps.sendJson,
  });
  const auth = createAuthService({
    sessionCookieName: deps.SESSION_COOKIE_NAME,
    store: deps.store,
  });
  const dashboard = createDashboardService({
    HttpError: deps.HttpError,
    normalizeAnnotationRecord: deps.normalizeAnnotationRecord,
    normalizeDiscussionRecord: deps.normalizeDiscussionRecord,
    normalizePaperRecord: deps.normalizePaperRecord,
    serializeUser: auth.serializeUser,
    store: deps.store,
  });
  const speech = createSpeechService({
    attachmentsDir: deps.ATTACHMENTS_DIR,
    createAnnotationId: deps.createAnnotationId,
    createAttachmentId: deps.createAttachmentId,
    createDiscussionId: deps.createDiscussionId,
    dashboardService: dashboard,
    formatLimitInMb: deps.formatLimitInMb,
    fs: deps.fs,
    HttpError: deps.HttpError,
    MAX_ATTACHMENT_BYTES: deps.MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_COUNT: deps.MAX_ATTACHMENT_COUNT,
    MAX_TOTAL_ATTACHMENT_BYTES: deps.MAX_TOTAL_ATTACHMENT_BYTES,
    maxAttachmentBytes: deps.MAX_ATTACHMENT_BYTES,
    maxAttachmentCount: deps.MAX_ATTACHMENT_COUNT,
    maxTotalAttachmentBytes: deps.MAX_TOTAL_ATTACHMENT_BYTES,
    normalizeAnnotationRecord: deps.normalizeAnnotationRecord,
    normalizeAttachmentRecord: deps.normalizeAttachmentRecord,
    normalizeAttachmentRecords: deps.normalizeAttachmentRecords,
    normalizeDiscussionRecord: deps.normalizeDiscussionRecord,
    path: deps.path,
    readSpeechMutationBody: deps.readSpeechMutationBody,
    resolveAttachmentDescriptor: deps.resolveAttachmentDescriptor,
    resolveStorageAbsolutePath: deps.resolveStorageAbsolutePath,
    store: deps.store,
  });
  const papers = createPapersService({
    createPaperId: deps.createPaperId,
    dashboardService: dashboard,
    deleteSpeechAttachmentsForRecords: speech.deleteAttachmentsForRecords,
    enforceSnapshotArticleImagePolicy: deps.enforceSnapshotArticleImagePolicy,
    fs: deps.fs,
    HttpError: deps.HttpError,
    normalizeAnnotationRecord: deps.normalizeAnnotationRecord,
    normalizeDiscussionRecord: deps.normalizeDiscussionRecord,
    normalizePaperRecord: deps.normalizePaperRecord,
    path: deps.path,
    storageDir: deps.STORAGE_DIR,
    store: deps.store,
  });
  const assets = createAssetsService({
    HttpError: deps.HttpError,
    attachmentsDir: deps.ATTACHMENTS_DIR,
    clientDistDir: deps.CLIENT_DIST_DIR,
    fetchElsevierObject: papers.fetchElsevierObject,
    fs: deps.fs,
    mimeTypeByExtension: deps.MIME_TYPE_BY_EXTENSION,
    normalizeStorageRecordPath: deps.normalizeStorageRecordPath,
    path: deps.path,
    resolveStorageAbsolutePath: deps.resolveStorageAbsolutePath,
    sendJson: deps.sendJson,
    staticAssetCacheControl: deps.STATIC_ASSET_CACHE_CONTROL,
    staticHashedAssetCacheControl: deps.STATIC_HASHED_ASSET_CACHE_CONTROL,
    staticHtmlCacheControl: deps.STATIC_HTML_CACHE_CONTROL,
  });
  const users = createUsersService({
    HttpError: deps.HttpError,
    authService: auth,
    dashboardService: dashboard,
    deleteSnapshotByPath: papers.deleteSnapshotByPath,
    deleteSpeechAttachmentsForRecords: speech.deleteAttachmentsForRecords,
    normalizeAnnotationRecord: deps.normalizeAnnotationRecord,
    normalizeDiscussionRecord: deps.normalizeDiscussionRecord,
    normalizePaperRecord: deps.normalizePaperRecord,
    store: deps.store,
  });
  const system = createSystemService({
    assetsService: assets,
    attachmentsDir: deps.ATTACHMENTS_DIR,
    collectionFiles: {
      annotations: deps.ANNOTATIONS_FILE,
      discussions: deps.DISCUSSIONS_FILE,
      papers: deps.PAPERS_FILE,
    },
    fs: deps.fs,
    htmlDir: deps.HTML_DIR,
    storageDir: deps.STORAGE_DIR,
    store: deps.store,
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

module.exports = {
  createServices,
};
