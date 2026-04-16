const crypto = require("crypto");
const {
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  getUserRole,
  isAdminUser,
  isDiscussionReply,
  isReplyAnnotation,
} = require("../../../shared/papershare-shared");

function createUsersService(deps) {
  function invalidateDashboard() {
    deps.dashboardService?.invalidateAll?.();
  }

  function assertAdmin(user) {
    if (!isAdminUser(user)) {
      throw new deps.HttpError(403, "仅管理员可执行此操作");
    }
  }

  async function changePassword(userId, body) {
    const currentPassword = String(body?.currentPassword || "");
    const nextPassword = String(body?.nextPassword || "");

    if (!currentPassword || !nextPassword) {
      throw new Error("当前密码和新密码不能为空");
    }

    if (nextPassword.length < 4) {
      throw new Error("新密码至少需要 4 位");
    }

    if (currentPassword === nextPassword) {
      throw new Error("新密码不能与当前密码相同");
    }

    const user = deps.store.users.getById(userId);

    if (!user) {
      throw new Error("用户不存在");
    }

    if (!(await deps.authService.verifyPassword(currentPassword, user.passwordHash)).ok) {
      throw new Error("当前密码错误");
    }

    deps.store.users.update({
      ...user,
      mustChangePassword: false,
      passwordHash: await deps.authService.hashPassword(nextPassword),
      updatedAt: new Date().toISOString(),
    });
  }

  async function changeUsername(userId, body) {
    const nextUsername = normalizeUsername(body?.username);
    const users = deps.store.users.listAll();
    const userIndex = users.findIndex((item) => item.id === userId);

    if (userIndex === -1) {
      throw new deps.HttpError(404, "用户不存在");
    }

    const currentUser = users[userIndex];
    validateUsername(nextUsername, users, currentUser.id);

    if (currentUser.username === nextUsername) {
      throw new Error("新用户名不能与当前用户名相同");
    }

    const updatedUser = {
      ...currentUser,
      username: nextUsername,
      updatedAt: new Date().toISOString(),
    };

    deps.store.runInTransaction((repositories) => {
      repositories.users.update(updatedUser);
      syncUsernameAcrossRecords(repositories, currentUser, nextUsername, {
        normalizeAnnotationRecord: deps.normalizeAnnotationRecord,
        normalizeDiscussionRecord: deps.normalizeDiscussionRecord,
        normalizePaperRecord: deps.normalizePaperRecord,
      });
    });
    invalidateDashboard();

    return deps.authService.serializeUser(updatedUser);
  }

  async function createMemberUser(body) {
    const username = normalizeUsername(body?.username);
    const password = String(body?.password || "");
    const users = deps.store.users.listAll();
    validateUsername(username, users);
    validatePasswordForCreation(password);

    const createdAt = new Date().toISOString();
    const user = {
      id: createUserId(username),
      username,
      role: "member",
      mustChangePassword: false,
      passwordHash: await deps.authService.hashPassword(password),
      createdAt,
      updatedAt: createdAt,
    };

    deps.store.users.insert(user);
    invalidateDashboard();
    return deps.authService.serializeUser(user);
  }

  async function deleteById(currentUserId, userId, options = {}) {
    if (!userId) {
      throw new Error("缺少用户 ID");
    }

    if (userId === currentUserId) {
      throw new Error("不能删除当前登录的管理员账号");
    }

    const user = deps.store.users.getById(userId);

    if (!user) {
      throw new deps.HttpError(404, "用户不存在");
    }

    if (getUserRole(user) === "admin") {
      throw new Error("不能删除管理员账号");
    }

    const purgeContent = options.purgeContent === true;
    const deletedContent = purgeContent ? await deleteUserOwnedContent(userId) : null;

    deps.store.runInTransaction((repositories) => {
      repositories.sessions.deleteByUserId(userId);
      repositories.users.deleteById(userId);
    });
    invalidateDashboard();

    return {
      deletedUserId: userId,
      purgeContent,
      deletedContent,
    };
  }

  async function transferAdminRole(currentUserId, targetUserId) {
    if (!targetUserId) {
      throw new Error("缺少目标用户");
    }

    if (targetUserId === currentUserId) {
      throw new Error("不能转让给当前管理员自己");
    }

    const users = deps.store.users.listAll();
    const currentUserIndex = users.findIndex((item) => item.id === currentUserId);
    const targetUserIndex = users.findIndex((item) => item.id === targetUserId);

    if (currentUserIndex === -1) {
      throw new deps.HttpError(404, "当前管理员不存在");
    }

    if (targetUserIndex === -1) {
      throw new deps.HttpError(404, "目标用户不存在");
    }

    const currentUser = users[currentUserIndex];
    const targetUser = users[targetUserIndex];

    if (getUserRole(targetUser) === "admin") {
      throw new Error("目标用户已经是管理员");
    }

    const updatedAt = new Date().toISOString();
    const nextCurrentUser = {
      ...currentUser,
      role: "member",
      updatedAt,
    };
    const nextTargetUser = {
      ...targetUser,
      role: "admin",
      updatedAt,
    };

    deps.store.runInTransaction((repositories) => {
      repositories.users.update(nextCurrentUser);
      repositories.users.update(nextTargetUser);
    });
    invalidateDashboard();

    return {
      currentUser: deps.authService.serializeUser(nextCurrentUser),
      targetUser: deps.authService.serializeUser(nextTargetUser),
    };
  }

  async function ensureDefaultUsers(defaultUsers) {
    const users = deps.store.users.listAll();
    const usersById = new Map(users.map((user) => [user.id, user]));
    const usersByUsername = new Map(users.map((user) => [user.username, user]));

    for (const defaultUser of Array.isArray(defaultUsers) ? defaultUsers : []) {
      const existingUser = usersById.get(defaultUser.id) || usersByUsername.get(defaultUser.username);

      if (!existingUser) {
        const { passwordEnvVar, ...defaultUserRecord } = defaultUser;
        const password = readRequiredBootstrapPassword(defaultUser);

        deps.store.users.insert({
          ...defaultUserRecord,
          mustChangePassword: true,
          passwordHash: await deps.authService.hashPassword(password),
        });
        continue;
      }

      const nextRole = defaultUser.role || getUserRole(existingUser);
      const nextCreatedAt = existingUser.createdAt || defaultUser.createdAt;

      if (existingUser.role !== nextRole || existingUser.createdAt !== nextCreatedAt) {
        deps.store.users.update({
          ...existingUser,
          role: nextRole,
          createdAt: nextCreatedAt,
        });
      }
    }
  }

  async function deleteUserOwnedContent(userId) {
    const user = deps.store.users.getById(userId);

    if (!user) {
      return {
        paperCount: 0,
        annotationCount: 0,
        discussionCount: 0,
      };
    }

    const deletedPapers = deps.store.papers
      .listByUser(user.id, user.username)
      .map((paper) => deps.normalizePaperRecord(paper));
    const deletedPaperIds = new Set(deletedPapers.map((paper) => paper.id));
    const deletedAnnotationsFromPapers = [];
    const deletedDiscussionsFromPapers = [];

    deletedPapers.forEach((paper) => {
      deletedAnnotationsFromPapers.push(
        ...deps.store.annotations.listByPaperId(paper.id).map((annotation) =>
          deps.normalizeAnnotationRecord(annotation)
        )
      );
      deletedDiscussionsFromPapers.push(
        ...deps.store.discussions.listByPaperId(paper.id).map((discussion) =>
          deps.normalizeDiscussionRecord(discussion)
        )
      );
    });

    const ownedAnnotations = deps.store.annotations
      .listByUser(user.id, user.username)
      .map((annotation) => deps.normalizeAnnotationRecord(annotation))
      .filter((annotation) => !deletedPaperIds.has(annotation.paperId));
    const ownedDiscussions = deps.store.discussions
      .listByUser(user.id, user.username)
      .map((discussion) => deps.normalizeDiscussionRecord(discussion))
      .filter((discussion) => !deletedPaperIds.has(discussion.paperId));
    const affectedPaperIds = collectPaperIdsFromRecords([...ownedAnnotations, ...ownedDiscussions]);
    let deletedAnnotations = [...deletedAnnotationsFromPapers];
    let deletedDiscussions = [...deletedDiscussionsFromPapers];

    deps.store.runInTransaction((repositories) => {
      deletedPapers.forEach((paper) => {
        repositories.annotations.deleteByPaperId(paper.id);
        repositories.discussions.deleteByPaperId(paper.id);
      });

      repositories.papers.deleteByIds(Array.from(deletedPaperIds));
      deletedAnnotations = dedupeRecordsById([
        ...deletedAnnotations,
        ...deleteOwnedSpeechRecordsFromStore(repositories.annotations, ownedAnnotations, {
          getRootId: getThreadRootAnnotationId,
          isReply: isReplyAnnotation,
          normalizeRecord: deps.normalizeAnnotationRecord,
          parentKey: "parent_annotation_id",
        }),
      ]);
      deletedDiscussions = dedupeRecordsById([
        ...deletedDiscussions,
        ...deleteOwnedSpeechRecordsFromStore(repositories.discussions, ownedDiscussions, {
          getRootId: getThreadRootDiscussionId,
          isReply: isDiscussionReply,
          normalizeRecord: deps.normalizeDiscussionRecord,
          parentKey: "parent_discussion_id",
        }),
      ]);
      refreshPaperActivitiesInRepositories(repositories, affectedPaperIds);
    });

    await Promise.all([
      Promise.all(deletedPapers.map((paper) => deps.deleteSnapshotByPath(paper.snapshotPath))),
      deps.deleteSpeechAttachmentsForRecords([...deletedAnnotations, ...deletedDiscussions]),
    ]);

    return {
      paperCount: deletedPapers.length,
      annotationCount: deletedAnnotations.length,
      discussionCount: deletedDiscussions.length,
    };
  }

  return {
    assertAdmin,
    changePassword,
    changeUsername,
    createMemberUser,
    deleteById,
    ensureDefaultUsers,
    transferAdminRole,
  };
}

function collectPaperIdsFromRecords(records) {
  return Array.from(
    new Set(
      (Array.isArray(records) ? records : [])
        .map((record) => String(record?.paperId || record?.id || "").trim())
        .filter(Boolean)
    )
  );
}

function refreshPaperActivitiesInRepositories(repositories, paperIds) {
  repositories.papers.refreshActivitiesByIds(paperIds);
}

function syncUsernameAcrossRecords(repositories, currentUser, nextUsername, normalizers) {
  const currentUserId = String(currentUser?.id || "").trim();
  const currentUsername = String(currentUser?.username || "").trim();
  const affectedPaperIds = new Set();

  repositories.papers.listByUser(currentUserId, currentUsername).forEach((paper) => {
    repositories.papers.update(
      normalizers.normalizePaperRecord({
        ...paper,
        created_by_user_id: currentUserId || paper.created_by_user_id,
        created_by_username: nextUsername,
      })
    );
  });

  repositories.annotations.listByUser(currentUserId, currentUsername).forEach((annotation) => {
    if (annotation.paperId) {
      affectedPaperIds.add(annotation.paperId);
    }

    repositories.annotations.update(
      normalizers.normalizeAnnotationRecord({
        ...annotation,
        created_by_user_id: currentUserId || annotation.created_by_user_id,
        created_by_username: nextUsername,
      })
    );
  });

  repositories.discussions.listByUser(currentUserId, currentUsername).forEach((discussion) => {
    if (discussion.paperId) {
      affectedPaperIds.add(discussion.paperId);
    }

    repositories.discussions.update(
      normalizers.normalizeDiscussionRecord({
        ...discussion,
        created_by_user_id: currentUserId || discussion.created_by_user_id,
        created_by_username: nextUsername,
      })
    );
  });

  refreshPaperActivitiesInRepositories(repositories, Array.from(affectedPaperIds));
}

function deleteOwnedSpeechRecordsFromStore(repository, ownedRecords, options) {
  const deletedRecords = [];

  ownedRecords
    .filter((record) => !options.isReply(record))
    .forEach((record) => {
      const currentRecord = repository.getById(record.id);

      if (!currentRecord) {
        return;
      }

      const threadRecords = dedupeRecordsById([
        options.normalizeRecord(currentRecord),
        ...repository.listByRootId(record.id).map((item) => options.normalizeRecord(item)),
      ]);

      repository.deleteByIds(threadRecords.map((item) => item.id));
      deletedRecords.push(...threadRecords);
    });

  ownedRecords
    .filter((record) => options.isReply(record))
    .forEach((record) => {
      const currentRecord = repository.getById(record.id);

      if (!currentRecord) {
        return;
      }

      const normalizedRecord = options.normalizeRecord(currentRecord);
      const fallbackParentId =
        String(normalizedRecord[options.parentKey] || "").trim() || options.getRootId(normalizedRecord);

      repository.reparentChildren(record.id, fallbackParentId);
      repository.deleteById(record.id);
      deletedRecords.push(normalizedRecord);
    });

  return dedupeRecordsById(deletedRecords);
}

function dedupeRecordsById(records) {
  const seenIds = new Set();

  return records.filter((record) => {
    const recordId = String(record?.id || "").trim();

    if (!recordId || seenIds.has(recordId)) {
      return false;
    }

    seenIds.add(recordId);
    return true;
  });
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function getUsernameLookupKey(username) {
  return normalizeUsername(username).toLowerCase();
}

function validateUsername(username, users, excludedUserId = "") {
  if (!username) {
    throw new Error("用户名不能为空");
  }

  if (username.length < 2) {
    throw new Error("用户名至少需要 2 个字符");
  }

  if (username.length > 32) {
    throw new Error("用户名不能超过 32 个字符");
  }

  if (/\s/.test(username)) {
    throw new Error("用户名不能包含空格");
  }

  const nextUsernameKey = getUsernameLookupKey(username);
  const duplicatedUser = users.find(
    (user) => user.id !== excludedUserId && getUsernameLookupKey(user.username) === nextUsernameKey
  );

  if (duplicatedUser) {
    throw new Error("该用户名已被占用");
  }
}

function validatePasswordForCreation(password) {
  if (!password) {
    throw new Error("初始密码不能为空");
  }

  if (password.length < 4) {
    throw new Error("初始密码至少需要 4 位");
  }
}

function readRequiredBootstrapPassword(defaultUser) {
  const passwordEnvVar = String(defaultUser?.passwordEnvVar || "").trim();
  const username = String(defaultUser?.username || "").trim() || defaultUser?.id || "bootstrap-user";

  if (!passwordEnvVar) {
    throw new Error(`Bootstrap 用户 ${username} 未配置 passwordEnvVar`);
  }

  if (!Object.prototype.hasOwnProperty.call(process.env, passwordEnvVar)) {
    throw new Error(
      `Bootstrap 用户 ${username} 缺少初始密码环境变量 ${passwordEnvVar}，请在首次启动前显式配置`
    );
  }

  const password = String(process.env[passwordEnvVar] ?? "");

  try {
    validatePasswordForCreation(password);
  } catch (error) {
    throw new Error(
      `Bootstrap 用户 ${username} 的初始密码环境变量 ${passwordEnvVar} 无效：${error.message}`
    );
  }

  return password;
}

function createUserId(username) {
  const slug = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suffix = crypto.randomBytes(3).toString("hex");

  return slug ? `user-${slug}-${suffix}` : `user-${Date.now()}-${suffix}`;
}

module.exports = {
  createUsersService,
};
