export function AuthGate({
  hidden = false,
  isSubmitting = false,
  loginStatus = "请输入账号密码",
  onPasswordInput,
  onSubmit,
  onUsernameInput,
  password = "",
  username = "",
}) {
  return (
    <section id="auth-gate" className={`auth-gate${hidden ? " is-hidden" : ""}`}>
      <div className="auth-card">
        <p className="eyebrow">Member Login</p>
        <h2>登录</h2>

        <form id="login-form" className="paper-form" onSubmit={onSubmit}>
          <label className="field">
            <span>用户名</span>
            <input
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              value={typeof onUsernameInput === "function" ? username : undefined}
              onInput={onUsernameInput}
              required
            />
          </label>

          <label className="field">
            <span>密码</span>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={typeof onPasswordInput === "function" ? password : undefined}
              onInput={onPasswordInput}
              required
            />
          </label>

          <span id="login-status" className="status-pill">
            {loginStatus}
          </span>
          <button id="login-button" className="primary-button" type="submit" disabled={isSubmitting}>
            登录
          </button>
        </form>
      </div>
    </section>
  );
}
