import mainContentHtml from "./main-content.html?raw";
import { AppHeader } from "../components/AppHeader.jsx";
import { AuthGate } from "../components/AuthGate.jsx";
import { RawMarkup } from "../shared/raw-markup.jsx";

export function CatalogPage() {
  return (
    <>
      <AppHeader showViewSwitcher={true} />
      <div className="page-shell">
        <AuthGate />
        <RawMarkup html={mainContentHtml} />
      </div>
    </>
  );
}
