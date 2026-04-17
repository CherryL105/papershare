import { JSX } from "preact";

interface AuthGateProps {
  hidden?: boolean;
  isSubmitting?: boolean;
  loginStatus?: string;
  onPasswordInput?: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => void;
  onSubmit?: (event: JSX.TargetedEvent<HTMLFormElement, Event>) => void;
  onUsernameInput?: (event: JSX.TargetedEvent<HTMLInputElement, Event>) => void;
  password?: string;
  username?: string;
}

export function AuthGate({
  hidden = false,
  isSubmitting = false,
  loginStatus = "请输入账号密码",
  onPasswordInput,
  onSubmit,
  onUsernameInput,
  password = "",
  username = "",
}: AuthGateProps) {
  return (
    <section id="auth-gate" className={`grid place-items-center min-h-[min(72vh,760px)]${hidden ? " hidden is-hidden" : ""}`}>
      <div className="w-[min(100%,460px)] p-7 border border-paper-border rounded-[28px] bg-gradient-to-b from-white/92 to-[#fffaf2]/96 bg-paper shadow-custom">
        <p className="m-0 mb-2.5 text-[12px] tracking-[0.24em] uppercase text-muted">Member Login</p>
        <h2 className="m-0 mb-2.5 text-[clamp(28px,4vw,36px)] leading-[1.15] font-bold">登录</h2>

        <form id="login-form" className="grid gap-3" onSubmit={onSubmit}>
          <label className="grid gap-2">
            <span className="text-[13px] text-muted">用户名</span>
            <input
              id="login-username"
              className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
              name="username"
              type="text"
              autoComplete="username"
              value={typeof onUsernameInput === "function" ? username : undefined}
              onInput={onUsernameInput}
              required
            />
          </label>

          <label className="grid gap-2">
            <span className="text-[13px] text-muted">密码</span>
            <input
              id="login-password"
              className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
              name="password"
              type="password"
              autoComplete="current-password"
              value={typeof onPasswordInput === "function" ? password : undefined}
              onInput={onPasswordInput}
              required
            />
          </label>

          <span id="login-status" className="text-muted text-[13px]">
            {loginStatus}
          </span>
          <button
            id="login-button"
            className="w-full mt-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c] disabled:cursor-not-allowed disabled:transform-none"
            type="submit"
            disabled={isSubmitting}
          >
            登录
          </button>
        </form>
      </div>
    </section>
  );
}
