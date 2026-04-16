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
    getSessionTokenFromRequest: deps.getSessionTokenFromRequest,
    readRequestJson: deps.readRequestJson,
    readSpeechMutationBody: deps.readSpeechMutationBody,
    sendJson: deps.sendJson,
    serializeExpiredSessionCookie: deps.serializeExpiredSessionCookie,
    serializeSessionCookie: deps.serializeSessionCookie,
  });
  const system = createSystemService({
    collectionFiles: {
      annotations: deps.ANNOTATIONS_FILE,
      discussions: deps.DISCUSSIONS_FILE,
      papers: deps.PAPERS_FILE,
    },
    ensureStorageFiles: deps.ensureStorageFiles,
    getJsonCollectionLength: deps.getJsonCollectionLength,
  });
  const auth = createAuthService({
    deleteSession: deps.deleteSession,
    getCurrentUserFromRequest: deps.getCurrentUserFromRequest,
    loginUser: deps.loginUser,
    serializeCurrentUser: deps.serializeCurrentUser || deps.serializeUser,
    serializeUser: deps.serializeUser,
  });
  const users = createUsersService({
    assertAdminUser: deps.assertAdminUser,
    changeUserPassword: deps.changeUserPassword,
    changeUsername: deps.changeUsername,
    createMemberUser: deps.createMemberUser,
    deleteUserById: deps.deleteUserById,
    transferAdminRole: deps.transferAdminRole,
  });
  const dashboard = createDashboardService({
    HttpError: deps.HttpError,
    normalizeAnnotationRecord: deps.normalizeAnnotationRecord,
    normalizeDiscussionRecord: deps.normalizeDiscussionRecord,
    normalizePaperRecord: deps.normalizePaperRecord,
    serializeUser: deps.serializeUser,
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
    fetchElsevierObject: papers.fetchElsevierObject,
    servePrivateStorageAsset: deps.servePrivateStorageAsset,
    serveStaticAsset: deps.serveStaticAsset,
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
