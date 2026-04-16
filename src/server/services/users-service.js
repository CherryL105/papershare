function createUsersService(deps) {
  function invalidateDashboard() {
    deps.dashboardService?.invalidateAll?.();
  }

  async function changeUsername(userId, body) {
    const user = await deps.changeUsername(userId, body);
    invalidateDashboard();
    return user;
  }

  async function createMemberUser(body) {
    const user = await deps.createMemberUser(body);
    invalidateDashboard();
    return user;
  }

  async function deleteById(currentUserId, userId, options) {
    const result = await deps.deleteUserById(currentUserId, userId, options);
    invalidateDashboard();
    return result;
  }

  async function transferAdminRole(currentUserId, targetUserId) {
    const result = await deps.transferAdminRole(currentUserId, targetUserId);
    invalidateDashboard();
    return result;
  }

  return {
    assertAdmin: deps.assertAdminUser,
    changePassword: deps.changeUserPassword,
    changeUsername,
    createMemberUser,
    deleteById,
    transferAdminRole,
  };
}

module.exports = {
  createUsersService,
};
