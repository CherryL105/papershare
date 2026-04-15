export function AuthGate() {
  return (
    <section id="auth-gate" className="auth-gate">
      <div className="auth-card">
        <p className="eyebrow">Member Login</p>
        <h2>登录</h2>

        <form id="login-form" className="paper-form">
          <label className="field">
            <span>用户名</span>
            <input id="login-username" name="username" type="text" autoComplete="username" required />
          </label>

          <label className="field">
            <span>密码</span>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          <span id="login-status" className="status-pill">
            请输入账号密码
          </span>
          <button id="login-button" className="primary-button" type="submit">
            登录
          </button>
        </form>
      </div>
    </section>
  );
}
