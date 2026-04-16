import "temml/dist/Temml-Local.css";
import "../styles.css";

export async function bootLegacyRuntime() {
  const pageType = document.body?.dataset?.page || "catalog";

  if (pageType === "detail") {
    const runtime = await import("../legacy/detail-runtime.js");
    runtime.bootDetailLegacyRuntime();
    return;
  }

  const runtime = await import("../legacy/catalog-runtime.js");
  runtime.bootCatalogLegacyRuntime();
}
