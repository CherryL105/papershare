import { useEffect, useState } from "preact/hooks";
import {
  changePassword,
  changeUsername,
  setCatalogView,
  useClientState,
} from "../shared/client-store.js";

export function CatalogPasswordView({ hidden = false }) {
  const snapshot = useClientState();
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

  async function handleUsernameSubmit(event) {
    event.preventDefault();

    try {
      await changeUsername({ username: nextUsername });
      setNextUsername("");
    } catch (error) {
      // The shared store already exposes the latest status text.
    }
  }

  async function handlePasswordSubmit(event) {
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
    <section id="password-view" className={`account-view${hidden ? " is-hidden" : ""}`}>
      <section className="panel account-panel">
        <div className="panel-header panel-header-actions">
          <h3>账号设置</h3>
          <button
            id="password-back-button"
            className="ghost-button"
            type="button"
            disabled={isPasswordChangeRequired}
            onClick={() => void setCatalogView("profile")}
          >
            返回
          </button>
        </div>

        <div className="account-settings-stack">
          <section className="account-setting-group">
            <div className="panel-header">
              <h4>修改用户名</h4>
            </div>
            <p className="panel-tip">修改后，历史上传和发言中的显示名会同步更新。</p>
            <span id="username-status" className="status-pill">
              {snapshot.profile.usernameStatus}
            </span>
            <form id="username-form" className="paper-form" onSubmit={handleUsernameSubmit}>
              <label className="field">
                <span>当前用户名</span>
                <input id="current-username" type="text" readOnly value={currentUser?.username || ""} />
              </label>

              <label className="field">
                <span>新用户名</span>
                <input
                  id="next-username"
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
                className="primary-button"
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

          <section className="account-setting-group">
            <div className="panel-header">
              <h4>修改密码</h4>
            </div>
            <span id="password-status" className="status-pill">
              {snapshot.profile.passwordStatus}
            </span>
            <form id="password-form" className="paper-form" onSubmit={handlePasswordSubmit}>
              <label className="field">
                <span>当前密码</span>
                <input
                  id="current-password"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  disabled={!snapshot.auth.serverReady || !currentUser || snapshot.profile.isChangingPassword}
                  required
                  value={currentPassword}
                  onInput={(event) => setCurrentPassword(event.currentTarget.value)}
                />
              </label>

              <label className="field">
                <span>新密码</span>
                <input
                  id="next-password"
                  name="nextPassword"
                  type="password"
                  autoComplete="new-password"
                  disabled={!snapshot.auth.serverReady || !currentUser || snapshot.profile.isChangingPassword}
                  required
                  value={nextPassword}
                  onInput={(event) => setNextPassword(event.currentTarget.value)}
                />
              </label>

              <label className="field">
                <span>确认新密码</span>
                <input
                  id="confirm-password"
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
                className="primary-button"
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
