import { useEffect, useState } from "preact/hooks";
import { useClientState } from "../shared/client-store";
import {
  changePassword,
  changeUsername,
  setCatalogView,
} from "./catalog-store";
import { ClientState } from "../shared/types";
import { JSX } from "preact";

interface CatalogPasswordViewProps {
  hidden?: boolean;
}

export function CatalogPasswordView({ hidden = false }: CatalogPasswordViewProps) {
  const snapshot = useClientState() as ClientState;
  const currentUser = snapshot.auth.currentUser;
  const isPasswordChangeRequired = Boolean(currentUser?.mustChangePassword);
  const [nextUsername, setNextUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!currentUser) {
      setNextUsername("");
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
    }
  }, [currentUser]);

  async function handleUsernameSubmit(event: JSX.TargetedEvent<HTMLFormElement, Event>) {
    event.preventDefault();

    try {
      await changeUsername({ username: nextUsername });
      setNextUsername("");
    } catch (error) {
      // The shared store already exposes the latest status text.
    }
  }

  async function handlePasswordSubmit(event: JSX.TargetedEvent<HTMLFormElement, Event>) {
    event.preventDefault();

    try {
      await changePassword({
        confirmPassword,
        currentPassword,
        nextPassword,
      });
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
    } catch (error) {
      // The shared store already exposes the latest status text.
    }
  }

  return (
    <section id="password-view" className={`grid justify-items-center${hidden ? " hidden" : ""}`}>
      <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom w-[min(100%,640px)]">
        <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
          <h3 className="m-0 text-lg font-bold">账号设置</h3>
          <button
            id="password-back-button"
            className="inline-flex items-center justify-center min-h-[42px] px-4 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50"
            type="button"
            disabled={isPasswordChangeRequired}
            onClick={() => void setCatalogView("profile")}
          >
            返回
          </button>
        </div>

        <div className="grid gap-[18px]">
          <section className="grid gap-3 p-4.5 rounded-[20px] border border-[rgba(121,92,55,0.12)] bg-white/56">
            <div className="flex justify-between items-center flex-wrap gap-3 mb-0">
              <h4 className="m-0 text-[17px] font-bold">修改用户名</h4>
            </div>
            <p className="m-0 text-muted leading-relaxed text-sm">修改后，历史上传和发言中的显示名会同步更新。</p>
            <span id="username-status" className="text-muted text-[13px]">
              {snapshot.profile.usernameStatus}
            </span>
            <form id="username-form" className="grid gap-3" onSubmit={handleUsernameSubmit}>
              <label className="grid gap-2">
                <span className="text-[13px] text-muted">当前用户名</span>
                <input id="current-username" className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text opacity-70 cursor-not-allowed outline-none" type="text" readOnly value={currentUser?.username || ""} />
              </label>

              <label className="grid gap-2">
                <span className="text-[13px] text-muted">新用户名</span>
                <input
                  id="next-username"
                  className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
                  name="username"
                  type="text"
                  autoComplete="username"
                  disabled={
                    !snapshot.auth.serverReady ||
                    !currentUser ||
                    snapshot.profile.isUpdatingUsername ||
                    isPasswordChangeRequired
                  }
                  required
                  value={nextUsername}
                  onInput={(event) => setNextUsername(event.currentTarget.value)}
                />
              </label>

              <button
                id="change-username-button"
                className="w-full mt-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c]"
                type="submit"
                disabled={
                  !snapshot.auth.serverReady ||
                  !currentUser ||
                  snapshot.profile.isUpdatingUsername ||
                  isPasswordChangeRequired
                }
              >
                更新用户名
              </button>
            </form>
          </section>

          <section className="grid gap-3 p-4.5 rounded-[20px] border border-[rgba(121,92,55,0.12)] bg-white/56">
            <div className="flex justify-between items-center flex-wrap gap-3 mb-0">
              <h4 className="m-0 text-[17px] font-bold">修改密码</h4>
            </div>
            <span id="password-status" className="text-muted text-[13px]">
              {snapshot.profile.passwordStatus}
            </span>
            <form id="password-form" className="grid gap-3" onSubmit={handlePasswordSubmit}>
              <label className="grid gap-2">
                <span className="text-[13px] text-muted">当前密码</span>
                <input
                  id="current-password"
                  className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  disabled={!snapshot.auth.serverReady || !currentUser || snapshot.profile.isChangingPassword}
                  required
                  value={currentPassword}
                  onInput={(event) => setCurrentPassword(event.currentTarget.value)}
                />
              </label>

              <label className="grid gap-2">
                <span className="text-[13px] text-muted">新密码</span>
                <input
                  id="next-password"
                  className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
                  name="nextPassword"
                  type="password"
                  autoComplete="new-password"
                  disabled={!snapshot.auth.serverReady || !currentUser || snapshot.profile.isChangingPassword}
                  required
                  value={nextPassword}
                  onInput={(event) => setNextPassword(event.currentTarget.value)}
                />
              </label>

              <label className="grid gap-2">
                <span className="text-[13px] text-muted">确认新密码</span>
                <input
                  id="confirm-password"
                  className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  disabled={!snapshot.auth.serverReady || !currentUser || snapshot.profile.isChangingPassword}
                  required
                  value={confirmPassword}
                  onInput={(event) => setConfirmPassword(event.currentTarget.value)}
                />
              </label>

              <button
                id="change-password-button"
                className="w-full mt-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c]"
                type="submit"
                disabled={!snapshot.auth.serverReady || !currentUser || snapshot.profile.isChangingPassword}
              >
                更新密码
              </button>
            </form>
          </section>
        </div>
      </section>
    </section>
  );
}
