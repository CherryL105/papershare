import legacyPanelsHtml from "./legacy-panels.html?raw";
import { AppHeader } from "../components/AppHeader.jsx";
import { AuthGate } from "../components/AuthGate.jsx";
import { CatalogLibraryView } from "./CatalogLibraryView.jsx";
import { RawMarkup } from "../shared/raw-markup.jsx";

export function CatalogPage() {
  return (
    <>
      <AppHeader showViewSwitcher={true} />
      <div className="page-shell">
        <AuthGate />
        <main id="app-content" className="app-content is-hidden">
          <CatalogLibraryView />
          <RawMarkup html={legacyPanelsHtml} />
        </main>
      </div>
    </>
  );
}
