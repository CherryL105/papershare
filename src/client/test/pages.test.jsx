// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogPage } from "../catalog/CatalogPage.jsx";
import { DetailPage } from "../detail/DetailPage.jsx";
import { resetClientStoreForTests } from "../shared/client-store.js";

afterEach(() => {
  cleanup();
  resetClientStoreForTests();
});

describe("client page shells", () => {
  it("renders the catalog shell through Preact", () => {
    render(<CatalogPage />);

    expect(screen.getByText("Papershare 文章分享讨论")).toBeTruthy();
    expect(screen.getByText("上传新文章")).toBeTruthy();
    expect(document.querySelector("#view-switcher")).not.toBeNull();
    expect(document.querySelector("#paper-form")).not.toBeNull();
  });

  it("renders the detail shell through Preact", () => {
    render(<DetailPage />);

    expect(screen.getByText("Papershare 文章分享讨论")).toBeTruthy();
    expect(screen.getByText("←返回文章和讨论列表")).toBeTruthy();
    expect(document.querySelector("#library-panel-tabs")).not.toBeNull();
    expect(document.querySelector("#annotation-root")).not.toBeNull();
  });
});
