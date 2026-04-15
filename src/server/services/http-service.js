function createHttpService(deps) {
  return {
    applyCorsHeaders: deps.applyCorsHeaders,
    getSessionTokenFromRequest: deps.getSessionTokenFromRequest,
    readJson: deps.readRequestJson,
    readSpeechMutation: deps.readSpeechMutationBody,
    sendJson: deps.sendJson,
    serializeExpiredSessionCookie: deps.serializeExpiredSessionCookie,
    serializeSessionCookie: deps.serializeSessionCookie,
  };
}

module.exports = {
  createHttpService,
};
