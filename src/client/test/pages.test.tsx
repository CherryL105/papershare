// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogPage } from "../catalog/CatalogPage";
import { DetailPage } from "../detail/DetailPage";
import { resetClientStoreForTests } from "../shared/client-store";

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      authenticated: false,
      user: null,
    }),
  })) as any;
});

afterEach(() => {
  cleanup();
  resetClientStoreForTests();
  vi.restoreAllMocks();
});

describe("client page shells", () => {
  it("renders the catalog shell through Preact", async () => {
    render(<CatalogPage />);

    await waitFor(() => {
      expect(screen.getByText("上传新文章")).toBeTruthy();
    });
    expect(document.querySelector("#view-switcher")).not.toBeNull();
    expect(document.querySelector("#paper-form")).not.toBeNull();
  });

  it("renders the detail shell through Preact", async () => {
    render(<DetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Papershare 文章分享讨论")).toBeTruthy();
    });
    expect(screen.getByText("←返回文章和讨论列表")).toBeTruthy();
    expect(document.querySelector("#library-panel-tabs")).not.toBeNull();
    expect(document.querySelector("#annotation-root")).not.toBeNull();
  });
});
