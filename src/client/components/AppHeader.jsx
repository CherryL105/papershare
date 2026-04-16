export function AppHeader({
  authControlsHidden = true,
  currentView = "library",
  currentUserLabel = "",
  databaseStatus = "服务初始化中...",
  isPasswordChangeRequired = false,
  onLogout,
  onViewChange,
  showViewSwitcher = false,
}) {
  const isViewSwitcherHidden = authControlsHidden;

  return (
    <section className="page-header">
      <div className="top-bar">
        <div className="top-bar-brand">
          <p className="eyebrow top-bar-label">PaperShare</p>
          <span id="database-status" className="status-pill">
            {databaseStatus}
          </span>
        </div>

        <h1 id="page-title" className="top-bar-title">
          Papershare 文章分享讨论
        </h1>

        <div id="auth-controls" className={`auth-controls${authControlsHidden ? " is-hidden" : ""}`}>
          <span id="current-user" className="status-pill">
            {currentUserLabel}
          </span>
          <button id="logout-button" className="ghost-button" type="button" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </div>

      {showViewSwitcher ? (
        <header className="top-bar">
          <div id="view-switcher" className={`view-switcher${isViewSwitcherHidden ? " is-hidden" : ""}`}>
            <button
              id="library-view-button"
              className={`view-switch-button${currentView === "library" ? " active" : ""}`}
              type="button"
              disabled={authControlsHidden || isPasswordChangeRequired}
              onClick={() => onViewChange?.("library")}
            >
              文章与讨论
            </button>
            <button
              id="profile-view-button"
              className={`view-switch-button${currentView === "profile" ? " active" : ""}`}
              type="button"
              disabled={authControlsHidden || isPasswordChangeRequired}
              onClick={() => onViewChange?.("profile")}
            >
              个人中心
            </button>
            <button
              id="member-view-button"
              className={`view-switch-button${currentView === "members" ? " active" : ""}`}
              type="button"
              disabled={authControlsHidden || isPasswordChangeRequired}
              onClick={() => onViewChange?.("members")}
            >
              组员动向
            </button>
          </div>
        </header>
      ) : null}
    </section>
  );
}
