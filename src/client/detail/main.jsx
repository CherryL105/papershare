import { render } from "preact";
import { DetailPage } from "./DetailPage.jsx";
import { bootLegacyRuntime } from "../shared/legacy-runtime.js";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Detail root container was not found.");
}

render(<DetailPage />, root);
void bootLegacyRuntime();
