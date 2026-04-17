import { useEffect, useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { AppHeader } from "../components/AppHeader";
import { AuthGate } from "../components/AuthGate";
import { useClientState, CATALOG_VIEWS } from "../shared/client-store";
import { login, logout } from "../shared/session-store";
import { initializeCatalogPage, setCatalogView } from "./catalog-store";
import { CatalogLibraryView } from "./CatalogLibraryView";
import { formatCurrentUserLabel, isCurrentUserAdmin } from "./catalog-helpers";
import { ClientState } from "../shared/types";
import { JSX } from "preact";

// Lazy load secondary views
const CatalogProfileView = lazy(() => import("./CatalogProfileView").then(m => ({ default: m.CatalogProfileView })));
const CatalogPasswordView = lazy(() => import("./CatalogPasswordView").then(m => ({ default: m.CatalogPasswordView })));
const CatalogUserManagementView = lazy(() => import("./CatalogUserManagementView").then(m => ({ default: m.CatalogUserManagementView })));
const CatalogMembersView = lazy(() => import("./CatalogMembersView").then(m => ({ default: m.CatalogMembersView })));

function Loading() {
  return (
    <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
      <div className="text-muted leading-relaxed">正在加载视图...</div>
    </section>
  );
}

export function CatalogPage() {
  const snapshot = useClientState() as ClientState;
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

  async function handleLoginSubmit(event: JSX.TargetedEvent<HTMLFormElement, Event>) {
    event.preventDefault();

    try {
      await login({ username, password });
      setPassword("");
      await initializeCatalogPage({ skipSessionInit: true });
    } catch (error) {
      // The shared store already exposes the latest login status.
    }
  }

  function renderCurrentView() {
    const currentView = snapshot.catalog.currentView;

    switch (currentView) {
      case CATALOG_VIEWS.library:
        return <CatalogLibraryView />;
      case CATALOG_VIEWS.profile:
        return <CatalogProfileView />;
      case CATALOG_VIEWS.password:
        return <CatalogPasswordView />;
      case CATALOG_VIEWS.userManagement:
        return isCurrentUserAdmin(snapshot.auth.currentUser) ? <CatalogUserManagementView /> : <CatalogProfileView />;
      case CATALOG_VIEWS.members:
        return <CatalogMembersView />;
      default:
        return <CatalogLibraryView />;
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
      <div className="min-h-[calc(100vh-72px)] max-w-[1640px] mx-auto grid grid-rows-[auto_auto_auto] gap-6 mt-6">
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
        <main id="app-content" className={`min-h-0${snapshot.auth.currentUser ? "" : " hidden is-hidden"}`}>
          <Suspense fallback={<Loading />}>
            {renderCurrentView()}
          </Suspense>
        </main>
      </div>
    </>
  );
}
