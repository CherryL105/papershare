import { useEffect, useState } from "preact/hooks";
import { AppHeader } from "../components/AppHeader.jsx";
import { AuthGate } from "../components/AuthGate.jsx";
import { useClientState } from "../shared/client-store.js";
import { login, logout } from "../shared/session-store.js";
import { initializeCatalogPage, setCatalogView } from "./catalog-store.js";
import { CatalogLibraryView } from "./CatalogLibraryView.jsx";
import { CatalogMembersView } from "./CatalogMembersView.jsx";
import { CatalogPasswordView } from "./CatalogPasswordView.jsx";
import { CatalogProfileView } from "./CatalogProfileView.jsx";
import { CatalogUserManagementView } from "./CatalogUserManagementView.jsx";
import { formatCurrentUserLabel, isCurrentUserAdmin } from "./catalog-helpers.js";

export function CatalogPage() {
  const snapshot = useClientState();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    void initializeCatalogPage();
  }, []);

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
      await initializeCatalogPage({ skipSessionInit: true });
    } catch (error) {
      // The shared store already exposes the latest login status.
    }
  }

  return (
    <>
      <AppHeader
        authControlsHidden={!snapshot.auth.currentUser}
        currentView={snapshot.catalog.currentView}
        currentUserLabel={formatCurrentUserLabel(snapshot.auth.currentUser)}
        databaseStatus={snapshot.auth.databaseStatus}
        isPasswordChangeRequired={Boolean(snapshot.auth.currentUser?.mustChangePassword)}
        onLogout={() => void logout()}
        onViewChange={(viewName) => void setCatalogView(viewName)}
        showViewSwitcher={true}
      />
      <div className="page-shell">
        <AuthGate
          hidden={Boolean(snapshot.auth.currentUser)}
          isSubmitting={snapshot.auth.isLoggingIn}
          loginStatus={snapshot.auth.loginStatus}
          password={password}
          username={username}
          onPasswordInput={(event) => setPassword(event.currentTarget.value)}
          onSubmit={handleLoginSubmit}
          onUsernameInput={(event) => setUsername(event.currentTarget.value)}
        />
        <main id="app-content" className={`app-content${snapshot.auth.currentUser ? "" : " is-hidden"}`}>
          <CatalogLibraryView hidden={snapshot.catalog.currentView !== "library"} />
          <CatalogProfileView hidden={snapshot.catalog.currentView !== "profile"} />
          <CatalogPasswordView hidden={snapshot.catalog.currentView !== "password"} />
          <CatalogUserManagementView
            hidden={
              snapshot.catalog.currentView !== "user-management" ||
              !isCurrentUserAdmin(snapshot.auth.currentUser)
            }
          />
          <CatalogMembersView hidden={snapshot.catalog.currentView !== "members"} />
        </main>
      </div>
    </>
  );
}
