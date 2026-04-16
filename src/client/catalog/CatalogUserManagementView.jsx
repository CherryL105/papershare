import { useEffect, useState } from "preact/hooks";
import {
  createUser,
  deleteUser,
  setCatalogView,
  transferAdmin,
} from "./catalog-store.js";
import { useClientState } from "../shared/client-store.js";
import { formatDateTime } from "../shared/session-store.js";
import { formatUserBadge, isCurrentUserAdmin } from "./catalog-helpers.js";

export function CatalogUserManagementView({ hidden = false }) {
  const snapshot = useClientState();
  const currentUser = snapshot.auth.currentUser;
  const isAdmin = isCurrentUserAdmin(currentUser);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!currentUser) {
      setUsername("");
      setPassword("");
      setConfirmPassword("");
    }
  }, [currentUser]);

  async function handleCreateUserSubmit(event) {
    event.preventDefault();

    try {
      await createUser({
        confirmPassword,
        password,
        username,
      });
      setUsername("");
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      // The shared store already exposes the latest status text.
    }
  }

  return (
    <section id="user-management-view" className={`account-view${hidden ? " is-hidden" : ""}`}>
      <section className="panel account-panel">
        <div className="panel-header panel-header-actions">
          <h3>用户管理</h3>
          <button
            id="user-management-back-button"
            className="ghost-button"
            type="button"
            onClick={() => void setCatalogView("profile")}
          >
            返回
          </button>
        </div>

        <div className="account-settings-stack">
          <section className="account-setting-group">
            <div className="panel-header">
              <h4>创建普通用户</h4>
            </div>
            <p className="panel-tip">新建用户默认为普通成员，可立刻使用用户名和初始密码登录。</p>
            <span id="user-management-status" className="status-pill">
              {snapshot.members.userManagementStatus}
            </span>
            <form id="create-user-form" className="paper-form" onSubmit={handleCreateUserSubmit}>
              <label className="field">
                <span>用户名</span>
                <input
                  id="create-user-username"
                  name="username"
                  type="text"
                  autoComplete="off"
                  disabled={
                    !snapshot.auth.serverReady ||
                    !isAdmin ||
                    snapshot.members.isCreatingUser ||
                    snapshot.members.isManagingUser
                  }
                  required
                  value={username}
                  onInput={(event) => setUsername(event.currentTarget.value)}
                />
              </label>

              <label className="field">
                <span>初始密码</span>
                <input
                  id="create-user-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  disabled={
                    !snapshot.auth.serverReady ||
                    !isAdmin ||
                    snapshot.members.isCreatingUser ||
                    snapshot.members.isManagingUser
                  }
                  required
                  value={password}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                />
              </label>

              <label className="field">
                <span>确认初始密码</span>
                <input
                  id="create-user-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  disabled={
                    !snapshot.auth.serverReady ||
                    !isAdmin ||
                    snapshot.members.isCreatingUser ||
                    snapshot.members.isManagingUser
                  }
                  required
                  value={confirmPassword}
                  onInput={(event) => setConfirmPassword(event.currentTarget.value)}
                />
              </label>

              <button
                id="create-user-button"
                className="primary-button"
                type="submit"
                disabled={
                  !snapshot.auth.serverReady ||
                  !isAdmin ||
                  snapshot.members.isCreatingUser ||
                  snapshot.members.isManagingUser
                }
              >
                创建普通用户
              </button>
            </form>
          </section>

          <section className="account-setting-group">
            <div className="panel-header">
              <h4>现有用户</h4>
              <span id="managed-user-count" className="status-pill">
                {snapshot.members.allUsers.length} 人
              </span>
            </div>
            <ManagedUserList snapshot={snapshot} />
          </section>
        </div>
      </section>
    </section>
  );
}

function ManagedUserList({ snapshot }) {
  const currentUser = snapshot.auth.currentUser;
  const isAdmin = isCurrentUserAdmin(currentUser);

  if (!currentUser) {
    return (
      <div id="managed-user-list" className="annotation-list empty-state">
        登录后可查看用户管理。
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div id="managed-user-list" className="annotation-list empty-state">
        只有管理员可以查看用户管理。
      </div>
    );
  }

  if (!snapshot.members.allUsers.length) {
    return (
      <div id="managed-user-list" className="annotation-list empty-state">
        当前还没有用户数据。
      </div>
    );
  }

  return (
    <div id="managed-user-list" className="annotation-list">
      {snapshot.members.allUsers.map((user) => {
        const isCurrentUser = user.id === currentUser.id;
        const canManageUser = !isCurrentUser && !isCurrentUserAdmin(user);
        const isDeletingUser =
          snapshot.members.isManagingUser &&
          snapshot.members.managedUserActionUserId === user.id &&
          snapshot.members.managedUserActionType === "delete";
        const isTransferringAdmin =
          snapshot.members.isManagingUser &&
          snapshot.members.managedUserActionUserId === user.id &&
          snapshot.members.managedUserActionType === "transfer";

        return (
          <article key={user.id} className="annotation-item">
            <div className="annotation-item-body">
              <div className="annotation-item-header">
                <strong>
                  {formatUserBadge(user)}
                  {isCurrentUser ? "（当前登录）" : ""}
                </strong>
                <time>{formatDateTime(user.createdAt)}</time>
              </div>
              <span className="annotation-target">用户名：{user.username}</span>
              <span>
                已上传 {user.uploadedPaperCount || 0} 篇 · 已发言 {user.annotationCount || 0} 条
              </span>
            </div>

            {canManageUser ? (
              <div className="annotation-item-actions">
                <button
                  className="ghost-button"
                  type="button"
                  disabled={snapshot.members.isManagingUser}
                  onClick={() => void handleTransferAdmin(user)}
                >
                  {isTransferringAdmin ? "转让中..." : "转让管理员"}
                </button>
                <button
                  className="ghost-button danger-button"
                  type="button"
                  disabled={snapshot.members.isManagingUser}
                  onClick={() => void handleDeleteUser(user)}
                >
                  {isDeletingUser ? "删除中..." : "删除用户"}
                </button>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

async function handleDeleteUser(user) {
  const confirmed = window.confirm(`确认删除用户 ${user.username} 吗？`);

  if (!confirmed) {
    return;
  }

  const purgeContent = window.confirm(
    [
      `是否一并删除 ${user.username} 的历史上传和发言？`,
      "确定：删除账号，并一并删除该用户上传的文献、其历史发言，以及这些文献下的相关批注和讨论。",
      "取消：仅删除账号，保留历史上传和发言。",
    ].join("\n")
  );

  try {
    await deleteUser({
      purgeContent,
      userId: user.id,
    });
  } catch (error) {
    // The shared store already exposes the latest status text.
  }
}

async function handleTransferAdmin(user) {
  const confirmed = window.confirm(
    `确认将管理员身份转让给 ${user.username} 吗？转让后你将变为普通成员。`
  );

  if (!confirmed) {
    return;
  }

  try {
    await transferAdmin(user.id);
  } catch (error) {
    // The shared store already exposes the latest status text.
  }
}
