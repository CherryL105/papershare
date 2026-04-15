const { createAssetsService } = require("./assets-service");
const { createAuthService } = require("./auth-service");
const { createDashboardService } = require("./dashboard-service");
const { createHttpService } = require("./http-service");
const { createPapersService } = require("./papers-service");
const { createSpeechService } = require("./speech-service");
const { createSystemService } = require("./system-service");
const { createUsersService } = require("./users-service");

function createServices(deps) {
  return {
    runtime: {
      PORT: deps.PORT,
    },
    http: createHttpService({
      applyCorsHeaders: deps.applyCorsHeaders,
      getSessionTokenFromRequest: deps.getSessionTokenFromRequest,
      readRequestJson: deps.readRequestJson,
      readSpeechMutationBody: deps.readSpeechMutationBody,
      sendJson: deps.sendJson,
      serializeExpiredSessionCookie: deps.serializeExpiredSessionCookie,
      serializeSessionCookie: deps.serializeSessionCookie,
    }),
    assets: createAssetsService({
      fetchElsevierObjectBinary: deps.fetchElsevierObjectBinary,
      normalizeMimeType: deps.normalizeMimeType,
      servePrivateStorageAsset: deps.servePrivateStorageAsset,
      serveStaticAsset: deps.serveStaticAsset,
    }),
    system: createSystemService({
      collectionFiles: {
        annotations: deps.ANNOTATIONS_FILE,
        discussions: deps.DISCUSSIONS_FILE,
        papers: deps.PAPERS_FILE,
      },
      ensureStorageFiles: deps.ensureStorageFiles,
      getJsonCollectionLength: deps.getJsonCollectionLength,
    }),
    auth: createAuthService({
      deleteSession: deps.deleteSession,
      getCurrentUserFromRequest: deps.getCurrentUserFromRequest,
      loginUser: deps.loginUser,
      serializeUser: deps.serializeUser,
    }),
    users: createUsersService({
      assertAdminUser: deps.assertAdminUser,
      changeUserPassword: deps.changeUserPassword,
      changeUsername: deps.changeUsername,
      createMemberUser: deps.createMemberUser,
      deleteUserById: deps.deleteUserById,
      transferAdminRole: deps.transferAdminRole,
    }),
    papers: createPapersService({
      HttpError: deps.HttpError,
      deletePaperById: deps.deletePaperById,
      enforceSnapshotArticleImagePolicy: deps.enforceSnapshotArticleImagePolicy,
      fetchAndStorePaper: deps.fetchAndStorePaper,
      fs: deps.fs,
      getPaperById: deps.getPaperById,
      importPaperFromHtml: deps.importPaperFromHtml,
      listPapersWithActivity: deps.listPapersWithActivity,
      path: deps.path,
      storageDir: deps.STORAGE_DIR,
    }),
    speech: createSpeechService({
      clearAnnotationsByPaperId: deps.clearAnnotationsByPaperId,
      deleteAnnotationById: deps.deleteAnnotationById,
      deleteDiscussionById: deps.deleteDiscussionById,
      getAnnotationsByPaperId: deps.getAnnotationsByPaperId,
      getAnnotationsByUserId: deps.getAnnotationsByUserId,
      getDiscussionsByPaperId: deps.getDiscussionsByPaperId,
      readSpeechMutationBody: deps.readSpeechMutationBody,
      saveAnnotation: deps.saveAnnotation,
      saveAnnotationReply: deps.saveAnnotationReply,
      saveDiscussion: deps.saveDiscussion,
      saveDiscussionReply: deps.saveDiscussionReply,
      updateAnnotationById: deps.updateAnnotationById,
      updateDiscussionById: deps.updateDiscussionById,
    }),
    dashboard: createDashboardService({
      getPublicUserProfile: deps.getPublicUserProfile,
      getUserDashboard: deps.getUserDashboard,
      listUsersWithStats: deps.listUsersWithStats,
    }),
  };
}

module.exports = {
  createServices,
};
