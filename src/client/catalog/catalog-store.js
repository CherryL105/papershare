import * as sharedModule from "../../../shared/papershare-shared.js";
import {
  CATALOG_VIEWS,
  createInitialMembersState,
  createInitialProfileState,
  enterPasswordChangeRequiredState,
  getClientState,
  isCurrentUserAdmin,
  normalizeCatalogView,
  persistCurrentUser,
  requiresPasswordChange,
  updateClientState,
} from "../shared/client-store.js";
import { apiRequest, initializeSession } from "../shared/session-store.js";

const shared = sharedModule?.default || sharedModule;
const { canDeleteOwnedRecord } = shared;

export async function refreshPapers() {
  const state = getClientState();

  if (!state.auth.currentUser) {
    updateClientState({
      papers: {
        items: [],
      },
      detail: {
        selectedPaper: null,
        selectedPaperId: "",
      },
    });
    return [];
  }

  const papers = await apiRequest("/api/papers");
  const sortedPapers = [...papers].sort(comparePapersForList);
  const selectedPaper =
    sortedPapers.find((paper) => paper.id === getClientState().detail.selectedPaperId) || null;

  updateClientState({
    papers: {
      items: sortedPapers,
    },
    detail: {
      selectedPaper: selectedPaper || getClientState().detail.selectedPaper,
    },
  });

  return sortedPapers;
}

export async function submitPaper({ sourceUrl, rawHtml }) {
  const normalizedSourceUrl = String(sourceUrl || "").trim();
  const normalizedRawHtml = String(rawHtml || "");
  const isHtmlImport = Boolean(normalizedRawHtml.trim());
  const isElsevierUpload = /(?:sciencedirect|elsevier)\.com/i.test(normalizedSourceUrl);

  updateClientState({
    catalog: {
      isSavingPaper: true,
      paperFormStatus: isHtmlImport
        ? "正在导入源码并写入 storage..."
        : isElsevierUpload
          ? "正在通过内置 Elsevier API 获取全文并写入 storage..."
          : "正在抓取网页并写入 storage...",
    },
  });

  try {
    const savedPaper = await apiRequest(isHtmlImport ? "/api/papers/import-html" : "/api/papers", {
      method: "POST",
      body: JSON.stringify({
        sourceUrl: normalizedSourceUrl,
        rawHtml: normalizedRawHtml,
      }),
    });

    updateClientState({
      catalog: {
        paperFormStatus: isHtmlImport
          ? "源码导入成功，已写入 storage"
          : isElsevierUpload
            ? "Elsevier 全文导入成功，已写入 storage"
            : "抓取成功，已写入 storage",
      },
    });

    await refreshPapers();
    return savedPaper;
  } catch (error) {
    updateClientState({
      catalog: {
        paperFormStatus: shouldOfferBrowserFetchFallback(error.message || "")
          ? "目标站点需要人工验证，请改用浏览器打开原文并导入 HTML 快照"
          : error.message || "抓取失败",
      },
    });
    throw error;
  } finally {
    updateClientState({
      catalog: {
        isSavingPaper: false,
      },
    });
  }
}

export async function initializeCatalogPage(options = {}) {
  const state = getClientState();
  const authState = options.skipSessionInit
    ? {
        authenticated: Boolean(state.auth.currentUser),
        user: state.auth.currentUser,
      }
    : await initializeSession();

  if (!authState.authenticated || !authState.user) {
    updateClientState({
      catalog: {
        currentView: CATALOG_VIEWS.library,
      },
      profile: createInitialProfileState(),
      members: createInitialMembersState(),
    });
    return authState;
  }

  if (requiresPasswordChange(authState.user)) {
    enterPasswordChangeRequiredState(authState.user);
    return authState;
  }

  await apiRequest("/api/status");
  updateClientState({
    auth: {
      serverReady: true,
      databaseStatus: "服务已连接",
    },
    catalog: {
      currentView: normalizeCatalogView(getClientState().catalog.currentView, authState.user),
      paperFormStatus: "等待抓取",
    },
    profile: {
      usernameStatus: "请输入新的用户名",
      passwordStatus: "请输入当前密码和新密码",
    },
    members: {
      userManagementStatus: "管理员可以创建新的普通用户",
    },
  });

  await refreshCatalogDependencies();

  return authState;
}

export async function refreshDashboard() {
  if (!getClientState().auth.currentUser) {
    updateClientState({
      profile: {
        uploadedPapers: [],
        myAnnotations: [],
        repliesToMyAnnotations: [],
      },
    });
    return {
      myAnnotations: [],
      repliesToMyAnnotations: [],
      uploadedPapers: [],
    };
  }

  const dashboard = await apiRequest("/api/me/dashboard");

  updateClientState({
    profile: {
      uploadedPapers: dashboard.uploadedPapers || [],
      myAnnotations: dashboard.myAnnotations || [],
      repliesToMyAnnotations: dashboard.repliesToMyAnnotations || [],
    },
  });

  return dashboard;
}

export async function refreshMembers() {
  const state = getClientState();

  if (!state.auth.currentUser) {
    updateClientState({
      members: createInitialMembersState(),
    });
    return [];
  }

  const users = await apiRequest("/api/users");
  const groupMembers = users.filter((user) => user.id !== getClientState().auth.currentUser.id);
  const nextSelectedMemberId = groupMembers.some(
    (member) => member.id === getClientState().members.selectedMemberId
  )
    ? getClientState().members.selectedMemberId
    : groupMembers[0]?.id || "";
  const shouldKeepSelectedProfile =
    getClientState().members.selectedMemberProfile?.user?.id === nextSelectedMemberId;

  updateClientState({
    members: {
      allUsers: users,
      groupMembers,
      selectedMemberId: nextSelectedMemberId,
      selectedMemberProfile: shouldKeepSelectedProfile
        ? getClientState().members.selectedMemberProfile
        : null,
    },
  });

  return groupMembers;
}

export async function refreshSelectedMemberProfile() {
  const state = getClientState();

  if (!state.auth.currentUser || !state.members.selectedMemberId) {
    updateClientState({
      members: {
        selectedMemberProfile: null,
      },
    });
    return null;
  }

  const selectedMemberId = state.members.selectedMemberId;
  const profile = await apiRequest(`/api/users/${encodeURIComponent(selectedMemberId)}/profile`);

  if (getClientState().members.selectedMemberId !== selectedMemberId) {
    return null;
  }

  updateClientState({
    members: {
      selectedMemberProfile: profile,
    },
  });

  return profile;
}

export async function selectMember(memberId) {
  const normalizedMemberId = String(memberId || "").trim();
  const state = getClientState();

  if (!state.auth.currentUser) {
    return null;
  }

  if (!normalizedMemberId) {
    updateClientState({
      members: {
        selectedMemberId: "",
        selectedMemberProfile: null,
      },
    });
    return null;
  }

  if (!state.members.groupMembers.some((member) => member.id === normalizedMemberId)) {
    return null;
  }

  if (
    state.members.selectedMemberId === normalizedMemberId &&
    state.members.selectedMemberProfile
  ) {
    return state.members.selectedMemberProfile;
  }

  updateClientState({
    catalog: {
      memberProfilePanel: "papers",
    },
    members: {
      selectedMemberId: normalizedMemberId,
      selectedMemberProfile: null,
    },
  });

  return refreshSelectedMemberProfile();
}

export async function setCatalogView(viewName) {
  const currentUser = getClientState().auth.currentUser;

  if (!currentUser) {
    return getClientState().catalog.currentView;
  }

  const nextView = normalizeCatalogView(viewName, currentUser);

  if (getClientState().catalog.currentView === nextView) {
    if (
      nextView === CATALOG_VIEWS.members &&
      getClientState().members.selectedMemberId &&
      !getClientState().members.selectedMemberProfile
    ) {
      await refreshSelectedMemberProfile();
    }

    return nextView;
  }

  updateClientState({
    catalog: {
      currentView: nextView,
    },
  });

  if (
    nextView === CATALOG_VIEWS.members &&
    getClientState().members.selectedMemberId &&
    !getClientState().members.selectedMemberProfile
  ) {
    await refreshSelectedMemberProfile();
  }

  return nextView;
}

export function setProfilePanel(panelName) {
  if (!getClientState().auth.currentUser) {
    return;
  }

  updateClientState({
    catalog: {
      profilePanel: panelName === "speeches" || panelName === "replies" ? panelName : "papers",
    },
  });
}

export function setMemberProfilePanel(panelName) {
  if (!getClientState().auth.currentUser) {
    return;
  }

  updateClientState({
    catalog: {
      memberProfilePanel: panelName === "speeches" ? "speeches" : "papers",
    },
  });
}

export async function changeUsername({ username }) {
  const state = getClientState();
  const currentUser = state.auth.currentUser;
  const nextUsername = String(username || "").trim();

  if (!currentUser || state.profile.isUpdatingUsername || requiresPasswordChange(currentUser)) {
    return null;
  }

  if (!nextUsername) {
    updateClientState({
      profile: {
        usernameStatus: "请输入新的用户名",
      },
    });
    return null;
  }

  if (nextUsername === currentUser.username) {
    updateClientState({
      profile: {
        usernameStatus: "新用户名不能与当前用户名相同",
      },
    });
    return null;
  }

  updateClientState({
    profile: {
      isUpdatingUsername: true,
      usernameStatus: "正在更新用户名...",
    },
  });

  try {
    const result = await apiRequest("/api/me/username", {
      method: "POST",
      body: JSON.stringify({
        username: nextUsername,
      }),
    });
    const nextUser = result.user || currentUser;

    persistCurrentUser(nextUser);
    updateClientState({
      auth: {
        currentUser: nextUser,
        loginStatus: `已登录为 ${nextUser.username}`,
      },
    });

    await refreshCatalogDependencies();

    if (getClientState().detail.selectedPaperId) {
      const detailStore = await import("../detail/detail-store.js");
      await detailStore.refreshSelectedPaperAnnotations();
      await detailStore.refreshSelectedPaperDiscussions();
    }

    updateClientState({
      profile: {
        usernameStatus: "用户名更新成功",
      },
    });

    return nextUser;
  } catch (error) {
    updateClientState({
      profile: {
        usernameStatus: error.message || "修改用户名失败",
      },
    });
    throw error;
  } finally {
    updateClientState({
      profile: {
        isUpdatingUsername: false,
      },
    });
  }
}

export async function changePassword({ confirmPassword, currentPassword, nextPassword }) {
  const state = getClientState();
  const currentUser = state.auth.currentUser;

  if (!currentUser || state.profile.isChangingPassword) {
    return null;
  }

  if (!currentPassword || !nextPassword || !confirmPassword) {
    updateClientState({
      profile: {
        passwordStatus: "请完整填写三个密码字段",
      },
    });
    return null;
  }

  if (nextPassword !== confirmPassword) {
    updateClientState({
      profile: {
        passwordStatus: "两次输入的新密码不一致",
      },
    });
    return null;
  }

  const wasPasswordChangeRequired = requiresPasswordChange(currentUser);

  updateClientState({
    profile: {
      isChangingPassword: true,
      passwordStatus: "正在更新密码...",
    },
  });

  try {
    await apiRequest("/api/me/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword,
        nextPassword,
      }),
    });

    const authState = await apiRequest("/api/auth/me");

    if (authState.authenticated && authState.user) {
      persistCurrentUser(authState.user);
      updateClientState({
        auth: {
          currentUser: authState.user,
          loginStatus: `已登录为 ${authState.user.username}`,
          serverReady: true,
          databaseStatus: authState.user.mustChangePassword
            ? "已登录，需先修改初始密码"
            : "服务已连接",
        },
        catalog: {
          currentView: normalizeCatalogView(getClientState().catalog.currentView, authState.user),
          paperFormStatus: authState.user.mustChangePassword ? "修改密码后可抓取文献" : "等待抓取",
        },
      });
    }

    await initializeCatalogPage({ skipSessionInit: true });

    updateClientState({
      catalog: {
        currentView: wasPasswordChangeRequired
          ? CATALOG_VIEWS.profile
          : getClientState().catalog.currentView,
      },
      profile: {
        passwordStatus: "密码更新成功",
      },
    });

    return authState.user || null;
  } catch (error) {
    updateClientState({
      profile: {
        passwordStatus: error.message || "修改密码失败",
      },
    });
    throw error;
  } finally {
    updateClientState({
      profile: {
        isChangingPassword: false,
      },
    });
  }
}

export async function createUser({ confirmPassword, password, username }) {
  const state = getClientState();
  const currentUser = state.auth.currentUser;
  const normalizedUsername = String(username || "").trim();
  const normalizedPassword = String(password || "");
  const normalizedConfirmPassword = String(confirmPassword || "");

  if (!currentUser || !isCurrentUserAdmin(currentUser) || state.members.isCreatingUser) {
    return null;
  }

  if (!normalizedUsername || !normalizedPassword || !normalizedConfirmPassword) {
    updateClientState({
      members: {
        userManagementStatus: "请完整填写用户名和两次密码",
      },
    });
    return null;
  }

  if (normalizedPassword !== normalizedConfirmPassword) {
    updateClientState({
      members: {
        userManagementStatus: "两次输入的初始密码不一致",
      },
    });
    return null;
  }

  updateClientState({
    members: {
      isCreatingUser: true,
      userManagementStatus: "正在创建用户...",
    },
  });

  try {
    const result = await apiRequest("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: normalizedUsername,
        password: normalizedPassword,
      }),
    });

    await refreshMembersData();

    updateClientState({
      members: {
        userManagementStatus: `用户 ${normalizedUsername} 创建成功`,
      },
    });

    return result.user || null;
  } catch (error) {
    updateClientState({
      members: {
        userManagementStatus: error.message || "创建用户失败",
      },
    });
    throw error;
  } finally {
    updateClientState({
      members: {
        isCreatingUser: false,
      },
    });
  }
}

export async function deleteUser({ purgeContent = false, userId }) {
  const state = getClientState();
  const currentUser = state.auth.currentUser;
  const normalizedUserId = String(userId || "").trim();

  if (!currentUser || !isCurrentUserAdmin(currentUser) || state.members.isManagingUser) {
    return null;
  }

  const targetUser =
    state.members.allUsers.find((user) => user.id === normalizedUserId) || null;

  if (!targetUser) {
    throw new Error("要删除的用户不存在。");
  }

  updateClientState({
    members: {
      isManagingUser: true,
      managedUserActionUserId: normalizedUserId,
      managedUserActionType: "delete",
      userManagementStatus: purgeContent
        ? `正在删除用户 ${targetUser.username}，并清理其历史上传和发言...`
        : `正在删除用户 ${targetUser.username}...`,
    },
  });

  try {
    const result = await apiRequest(
      `/api/users/${encodeURIComponent(normalizedUserId)}${purgeContent ? "?purgeContent=1" : ""}`,
      {
        method: "DELETE",
      }
    );

    if (purgeContent) {
      await refreshPapers();
      await refreshDashboard();

      if (getClientState().detail.selectedPaperId) {
        const detailStore = await import("../detail/detail-store.js");

        if (
          getClientState().papers.items.some(
            (paper) => paper.id === getClientState().detail.selectedPaperId
          )
        ) {
          await detailStore.refreshSelectedPaperAnnotations();
          await detailStore.refreshSelectedPaperDiscussions();
        } else {
          detailStore.clearSelectedDetailPaper();
        }
      }
    }

    await refreshMembersData();

    updateClientState({
      members: {
        userManagementStatus: purgeContent
          ? `用户 ${targetUser.username} 已删除，同时清理了 ${
              Number(result?.deletedContent?.paperCount || 0)
            } 篇上传及相关的 ${Number(result?.deletedContent?.annotationCount || 0)} 条批注和 ${
              Number(result?.deletedContent?.discussionCount || 0)
            } 条讨论`
          : `用户 ${targetUser.username} 已删除，历史上传和发言已保留`,
      },
    });

    return result;
  } catch (error) {
    updateClientState({
      members: {
        userManagementStatus: error.message || "删除用户失败",
      },
    });
    throw error;
  } finally {
    updateClientState({
      members: {
        isManagingUser: false,
        managedUserActionUserId: "",
        managedUserActionType: "",
      },
    });
  }
}

export async function transferAdmin(userId) {
  const state = getClientState();
  const currentUser = state.auth.currentUser;
  const normalizedUserId = String(userId || "").trim();

  if (!currentUser || !isCurrentUserAdmin(currentUser) || state.members.isManagingUser) {
    return null;
  }

  const targetUser =
    state.members.allUsers.find((user) => user.id === normalizedUserId) || null;

  if (!targetUser) {
    throw new Error("要转让的目标用户不存在。");
  }

  updateClientState({
    members: {
      isManagingUser: true,
      managedUserActionUserId: normalizedUserId,
      managedUserActionType: "transfer",
      userManagementStatus: `正在将管理员身份转让给 ${targetUser.username}...`,
    },
  });

  try {
    const result = await apiRequest(`/api/users/${encodeURIComponent(normalizedUserId)}/transfer-admin`, {
      method: "POST",
    });

    if (result.currentUser) {
      persistCurrentUser(result.currentUser);
      updateClientState({
        auth: {
          currentUser: result.currentUser,
          loginStatus: `已登录为 ${result.currentUser.username}`,
        },
      });
    }

    await refreshDashboard();
    await refreshMembersData();

    updateClientState({
      catalog: {
        currentView: CATALOG_VIEWS.profile,
      },
      members: {
        userManagementStatus: `管理员身份已转让给 ${targetUser.username}`,
      },
    });

    return result;
  } catch (error) {
    updateClientState({
      members: {
        userManagementStatus: error.message || "转让管理员失败",
      },
    });
    throw error;
  } finally {
    updateClientState({
      members: {
        isManagingUser: false,
        managedUserActionUserId: "",
        managedUserActionType: "",
      },
    });
  }
}

export async function deletePaperById(paperId) {
  const state = getClientState();
  const currentUser = state.auth.currentUser;
  const paper = state.papers.items.find((item) => item.id === paperId) || null;

  if (!currentUser || !paper) {
    return null;
  }

  if (!canDeleteOwnedRecord(paper, currentUser)) {
    throw new Error("你只能删除自己上传的文献，管理员 admin 可删除任意文献。");
  }

  const nextPaperId = getNextPaperIdAfterDeletion(paper.id);

  await apiRequest(`/api/papers/${encodeURIComponent(paper.id)}`, {
    method: "DELETE",
  });

  await refreshPapers();
  await refreshDashboard();
  await refreshMembersData();

  updateClientState({
    catalog: {
      paperFormStatus: "文献已删除",
    },
  });

  if (getClientState().detail.selectedPaperId === paper.id) {
    const detailStore = await import("../detail/detail-store.js");

    if (nextPaperId && getClientState().papers.items.some((item) => item.id === nextPaperId)) {
      await detailStore.selectPaper(nextPaperId);
    } else {
      detailStore.clearSelectedDetailPaper();
    }
  }

  return paper;
}

export async function deleteActivity(record) {
  const currentUser = getClientState().auth.currentUser;
  const speechType = record?.speech_type === "discussion" ? "discussion" : "annotation";
  const apiBasePath = speechType === "discussion" ? "/api/discussions" : "/api/annotations";

  if (!currentUser || !record?.id) {
    return null;
  }

  if (!canDeleteOwnedRecord(record, currentUser)) {
    throw new Error(
      speechType === "discussion"
        ? Boolean(record.is_reply)
          ? "无权删除该回复"
          : "无权删除该讨论"
        : Boolean(record.is_reply)
          ? "无权删除该回复"
          : "无权删除该批注"
    );
  }

  await apiRequest(`${apiBasePath}/${encodeURIComponent(record.id)}`, {
    method: "DELETE",
  });

  await refreshPapers();
  await refreshDashboard();
  await refreshMembersData();

  if (getClientState().detail.selectedPaperId && getClientState().detail.selectedPaperId === record.paperId) {
    const detailStore = await import("../detail/detail-store.js");
    await detailStore.refreshSelectedPaperAnnotations();
    await detailStore.refreshSelectedPaperDiscussions();
  }

  return record;
}

export function setPaperSearch(term) {
  updateClientState({
    catalog: {
      searchTerm: String(term || "").trim().toLowerCase(),
    },
  });
}

export function setPaperFormStatus(message) {
  updateClientState({
    catalog: {
      paperFormStatus: String(message || "").trim(),
    },
  });
}

export function getVisiblePapers(papers, searchTerm) {
  const normalizedSearchTerm = String(searchTerm || "").trim().toLowerCase();

  if (!normalizedSearchTerm) {
    return Array.isArray(papers) ? papers : [];
  }

  return (Array.isArray(papers) ? papers : []).filter((paper) =>
    matchesPaperSearchTerm(paper, normalizedSearchTerm)
  );
}

export function shouldOfferBrowserFetchFallback(message) {
  return /403|forbidden|captcha|cloudflare|challenge/i.test(String(message || ""));
}

async function refreshMembersData() {
  await refreshMembers();

  if (!getClientState().members.selectedMemberId) {
    updateClientState({
      members: {
        selectedMemberProfile: null,
      },
    });
    return null;
  }

  return refreshSelectedMemberProfile();
}

async function refreshCatalogDependencies() {
  const [papers] = await Promise.all([refreshPapers(), refreshDashboard(), refreshMembersData()]);
  return papers;
}

function comparePapersForList(left, right) {
  const leftUploadTime = new Date(left.createdAt || left.created_at || 0).getTime();
  const rightUploadTime = new Date(right.createdAt || right.created_at || 0).getTime();
  const leftActivityTime = new Date(left.latestSpeechAt || leftUploadTime || 0).getTime();
  const rightActivityTime = new Date(right.latestSpeechAt || rightUploadTime || 0).getTime();

  if (rightActivityTime !== leftActivityTime) {
    return rightActivityTime - leftActivityTime;
  }

  if (rightUploadTime !== leftUploadTime) {
    return rightUploadTime - leftUploadTime;
  }

  return String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
}

function matchesPaperSearchTerm(paper, searchTerm) {
  const searchableValues = [
    paper?.title,
    paper?.authors,
    paper?.journal,
    paper?.abstract,
    ...(Array.isArray(paper?.keywords) ? paper.keywords : []),
    paper?.created_by_username,
  ];

  return searchableValues.some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(searchTerm)
  );
}

function getNextPaperIdAfterDeletion(paperId) {
  const papers = getClientState().papers.items;
  const currentIndex = papers.findIndex((paper) => paper.id === paperId);

  if (currentIndex === -1) {
    return "";
  }

  return papers[currentIndex + 1]?.id || papers[currentIndex - 1]?.id || "";
}
