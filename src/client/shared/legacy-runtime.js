import "temml/dist/Temml-Local.css";
import "../styles.css";

export async function bootLegacyRuntime() {
  const pageType = document.body?.dataset?.page || "catalog";

  if (pageType !== "catalog") {
    return;
  }

  const runtime = await import("../legacy/catalog-runtime.js");
  runtime.bootCatalogLegacyRuntime();
}
