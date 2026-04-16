import { render } from "preact";
import { DetailPage } from "./DetailPage.jsx";

const root = document.getElementById("app");

if (!root) {
  throw new Error("Detail root container was not found.");
}

render(<DetailPage />, root);
