import { useEffect, useState } from "preact/hooks";
import { AppHeader } from "../components/AppHeader.jsx";
import { AuthGate } from "../components/AuthGate.jsx";
import { DetailLibraryView } from "./DetailLibraryView.jsx";
import { useClientState } from "../shared/client-store.js";
import { login, logout } from "../shared/session-store.js";
import { initializeDetailPage } from "./detail-store.js";

export function DetailPage() {
  const snapshot = useClientState();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!snapshot.auth.currentUser) {
      setPassword("");
    }
  }, [snapshot.auth.currentUser]);

  async function handleLoginSubmit(event) {
    event.preventDefault();

    try {
      await login({ username, password });
      setPassword("");
      await initializeDetailPage({ skipSessionInit: true });
    } catch (error) {
      // The shared store already exposes the latest status text.
    }
  }

  return (
    <>
      <AppHeader
        authControlsHidden={!snapshot.auth.currentUser}
        currentUserLabel={formatCurrentUserLabel(snapshot.auth.currentUser)}
        databaseStatus={snapshot.auth.databaseStatus}
        onLogout={() => void logout()}
      />
      <div className="page-shell">
        <AuthGate
          hidden={Boolean(snapshot.auth.currentUser)}
          isSubmitting={snapshot.auth.isLoggingIn}
          loginStatus={snapshot.auth.loginStatus}
          username={username}
          password={password}
          onSubmit={handleLoginSubmit}
          onUsernameInput={(event) => setUsername(event.currentTarget.value)}
          onPasswordInput={(event) => setPassword(event.currentTarget.value)}
        />
        <DetailLibraryView />
      </div>
    </>
  );
}

function formatCurrentUserLabel(user) {
  if (!user) {
    return "";
  }

  return user.role === "admin" || user.username === "admin"
    ? `${user.username}（管理员）`
    : user.username;
}
