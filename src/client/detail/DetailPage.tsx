import { useEffect, useState } from "preact/hooks";
import { AppHeader } from "../components/AppHeader";
import { AuthGate } from "../components/AuthGate";
import { DetailLibraryView } from "./DetailLibraryView";
import { useClientState } from "../shared/client-store";
import { login, logout } from "../shared/session-store";
import { initializeDetailPage } from "./detail-store";
import { ClientState, User } from "../shared/types";
import { JSX } from "preact";

export function DetailPage() {
  const snapshot = useClientState() as ClientState;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!snapshot.auth.currentUser) {
      setPassword("");
    }
  }, [snapshot.auth.currentUser]);

  async function handleLoginSubmit(event: JSX.TargetedEvent<HTMLFormElement, Event>) {
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
      <div className="min-h-[calc(100vh-72px)] max-w-[1640px] mx-auto grid grid-rows-[auto_auto_auto] gap-6 mt-6">
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

function formatCurrentUserLabel(user: User | null) {
  if (!user) {
    return "";
  }

  return user.role === "admin" || user.username === "admin"
    ? `${user.username}（管理员）`
    : user.username;
}
