function createDashboardService(deps) {
  return {
    getForUser: deps.getUserDashboard,
    getPublicUserProfile: deps.getPublicUserProfile,
    listUsersWithStats: deps.listUsersWithStats,
  };
}

module.exports = {
  createDashboardService,
};
