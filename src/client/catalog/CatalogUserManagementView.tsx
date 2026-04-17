import { useEffect, useState } from "preact/hooks";
import {
  createUser,
  deleteUser,
  setCatalogView,
  transferAdmin,
} from "./catalog-store";
import { useClientState } from "../shared/client-store";
import { formatDateTime } from "../shared/session-store";
import { formatUserBadge, isCurrentUserAdmin } from "./catalog-helpers";
import type { ClientState, UserWithStats } from "../shared/types";
import { JSX } from "preact";

interface CatalogUserManagementViewProps {
  hidden?: boolean;
}

export function CatalogUserManagementView({ hidden = false }: CatalogUserManagementViewProps) {
  const snapshot = useClientState() as ClientState;
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

  async function handleCreateUserSubmit(event: JSX.TargetedEvent<HTMLFormElement, Event>) {
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
    <section id="user-management-view" className={`grid justify-items-center${hidden ? " hidden" : ""}`}>
      <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom w-[min(100%,640px)]">
        <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
          <h3 className="m-0 text-lg font-bold">用户管理</h3>
          <button
            id="user-management-back-button"
            className="inline-flex items-center justify-center min-h-[42px] px-4 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95"
            type="button"
            onClick={() => void setCatalogView("profile")}
          >
            返回
          </button>
        </div>

        <div className="grid gap-[18px]">
          <section className="grid gap-3 p-4.5 rounded-[20px] border border-[rgba(121,92,55,0.12)] bg-white/56">
            <div className="flex justify-between items-center flex-wrap gap-3 mb-0">
              <h4 className="m-0 text-[17px] font-bold">创建普通用户</h4>
            </div>
            <p className="m-0 text-muted leading-relaxed text-sm">新建用户默认为普通成员，可立刻使用用户名和初始密码登录。</p>
            <span id="user-management-status" className="text-muted text-[13px]">
              {snapshot.members.userManagementStatus}
            </span>
            <form id="create-user-form" className="grid gap-3" onSubmit={handleCreateUserSubmit}>
              <label className="grid gap-2">
                <span className="text-[13px] text-muted">用户名</span>
                <input
                  id="create-user-username"
                  className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
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

              <label className="grid gap-2">
                <span className="text-[13px] text-muted">初始密码</span>
                <input
                  id="create-user-password"
                  className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
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

              <label className="grid gap-2">
                <span className="text-[13px] text-muted">确认初始密码</span>
                <input
                  id="create-user-confirm-password"
                  className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
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
                className="w-full mt-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c]"
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

          <section className="grid gap-3 p-4.5 rounded-[20px] border border-[rgba(121,92,55,0.12)] bg-white/56">
            <div className="flex justify-between items-center flex-wrap gap-3 mb-0">
              <h4 className="m-0 text-[17px] font-bold">现有用户</h4>
              <span id="managed-user-count" className="text-muted text-[13px]">
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

function ManagedUserList({ snapshot }: { snapshot: ClientState }) {
  const currentUser = snapshot.auth.currentUser;
  const isAdmin = isCurrentUserAdmin(currentUser);

  if (!currentUser) {
    return (
      <div id="managed-user-list" className="text-muted leading-relaxed">
        登录后可查看用户管理。
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div id="managed-user-list" className="text-muted leading-relaxed">
        只有管理员可以查看用户管理。
      </div>
    );
  }

  if (!snapshot.members.allUsers.length) {
    return (
      <div id="managed-user-list" className="text-muted leading-relaxed">
        当前还没有用户数据。
      </div>
    );
  }

  return (
    <div id="managed-user-list" className="grid gap-2.5">
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
          <article key={user.id} className="w-full min-w-0 text-left p-3.5 border border-[rgba(121,92,55,0.14)] rounded-2xl bg-white/74 transition-all hover:bg-white group">
            <div className="w-full min-w-0 p-0 grid gap-1.5">
              <div className="flex justify-between gap-3 items-start mb-1">
                <strong className="group-hover:text-accent transition-colors">
                  {formatUserBadge(user)}
                  {isCurrentUser ? "（当前登录）" : ""}
                </strong>
                <time className="text-muted text-[12px] whitespace-nowrap">{formatDateTime(user.createdAt)}</time>
              </div>
              <span className="text-accent text-[13px] leading-relaxed font-mono">用户名：{user.username}</span>
              <span className="text-muted text-[13px] leading-relaxed">
                已上传 {user.uploadedPaperCount || 0} 篇 · 已发言 {user.annotationCount || 0} 条
              </span>
            </div>

            {canManageUser ? (
              <div className="flex flex-wrap gap-2 justify-start mt-3">
                <button
                  className="inline-flex items-center justify-center min-h-[36px] px-3 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text text-sm transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50"
                  type="button"
                  disabled={snapshot.members.isManagingUser}
                  onClick={() => void handleTransferAdmin(user)}
                >
                  {isTransferringAdmin ? "转让中..." : "转让管理员"}
                </button>
                <button
                  className="inline-flex items-center justify-center min-h-[36px] px-3 border border-[rgba(139,30,45,0.18)] rounded-full text-[#8b1e2d] bg-white/60 text-sm transition-all hover:bg-[rgba(139,30,45,0.08)] active:scale-95 disabled:opacity-50"
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

async function handleDeleteUser(user: UserWithStats) {
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

async function handleTransferAdmin(user: UserWithStats) {
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
