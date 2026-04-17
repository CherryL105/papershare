interface AppHeaderProps {
  authControlsHidden?: boolean;
  currentView?: string;
  currentUserLabel?: string;
  databaseStatus?: string;
  isPasswordChangeRequired?: boolean;
  onLogout?: () => void;
  onViewChange?: (viewName: string) => void;
  showViewSwitcher?: boolean;
}

export function AppHeader({
  authControlsHidden = true,
  currentView = "library",
  currentUserLabel = "",
  databaseStatus = "服务初始化中...",
  isPasswordChangeRequired = false,
  onLogout,
  onViewChange,
  showViewSwitcher = false,
}: AppHeaderProps) {
  const isViewSwitcherHidden = authControlsHidden;

  return (
    <section className="flex flex-col items-stretch gap-5 min-h-0">
      <div className="relative z-20 w-full flex justify-between items-center flex-wrap gap-5 py-1">
        <div className="flex items-center flex-wrap gap-3 min-w-0">
          <p className="m-0 mb-0 text-[12px] tracking-[0.24em] uppercase text-muted">PaperShare</p>
          <span id="database-status" className="text-muted text-[13px]">
            {databaseStatus}
          </span>
        </div>

        <h1 id="page-title" className="m-0 flex-1 text-center text-[clamp(22px,2.2vw,30px)] leading-tight text-text">
          Papershare 文章分享讨论
        </h1>

        <div id="auth-controls" className={`flex items-center justify-end flex-wrap gap-2.5${authControlsHidden ? " hidden is-hidden" : ""}`}>
          <span id="current-user" className="text-muted text-[13px]">
            {currentUserLabel}
          </span>
          <button
            id="logout-button"
            className="max-w-full border border-[rgba(121,92,55,0.2)] rounded-full px-4 py-2 bg-white/70 text-text transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95"
            type="button"
            onClick={onLogout}
          >
            退出登录
          </button>
        </div>
      </div>

      {showViewSwitcher ? (
        <header className="relative z-20 w-full flex justify-between items-center flex-wrap gap-5 py-1">
          <div
            id="view-switcher"
            className={`flex items-center justify-center flex-wrap gap-2.5 p-1.5 border border-[rgba(121,92,55,0.14)] rounded-full bg-[#fffdf8]/95 w-full${
              isViewSwitcherHidden ? " hidden is-hidden" : ""
            }`}
          >
            <button
              id="library-view-button"
              className={`flex items-center justify-center min-h-[40px] px-[18px] border-0 rounded-full flex-1 transition-all duration-200 ${
                currentView === "library" ? "bg-accent text-white shadow-md active" : "bg-transparent text-muted hover:bg-accent/5"
              }`}
              type="button"
              disabled={authControlsHidden || isPasswordChangeRequired}
              onClick={() => onViewChange?.("library")}
            >
              文章与讨论
            </button>
            <button
              id="profile-view-button"
              className={`flex items-center justify-center min-h-[40px] px-[18px] border-0 rounded-full flex-1 transition-all duration-200 ${
                currentView === "profile" ? "bg-accent text-white shadow-md active" : "bg-transparent text-muted hover:bg-accent/5"
              }`}
              type="button"
              disabled={authControlsHidden || isPasswordChangeRequired}
              onClick={() => onViewChange?.("profile")}
            >
              个人中心
            </button>
            <button
              id="member-view-button"
              className={`flex items-center justify-center min-h-[40px] px-[18px] border-0 rounded-full flex-1 transition-all duration-200 ${
                currentView === "members" ? "bg-accent text-white shadow-md active" : "bg-transparent text-muted hover:bg-accent/5"
              }`}
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
