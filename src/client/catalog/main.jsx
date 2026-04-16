import { render } from "preact";
import { CatalogPage } from "./CatalogPage.jsx";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Catalog root container was not found.");
}

render(<CatalogPage />, root);
