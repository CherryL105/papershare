function createUsersService(deps) {
  return {
    assertAdmin: deps.assertAdminUser,
    changePassword: deps.changeUserPassword,
    changeUsername: deps.changeUsername,
    createMemberUser: deps.createMemberUser,
    deleteById: deps.deleteUserById,
    transferAdminRole: deps.transferAdminRole,
  };
}

module.exports = {
  createUsersService,
};
