import "temml/dist/Temml-Local.css";
import "../styles.css";

export async function bootLegacyRuntime() {
  await import("../legacy/app-runtime.js");
}
