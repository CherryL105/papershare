function createAuthService(deps) {
  return {
    deleteSession: deps.deleteSession,
    getCurrentUserFromRequest: deps.getCurrentUserFromRequest,
    login: deps.loginUser,
    serializeUser: deps.serializeUser,
  };
}

module.exports = {
  createAuthService,
};
