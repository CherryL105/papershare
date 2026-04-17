import { useEffect, useRef } from "preact/hooks";
import { useClientState, getClientState } from "../shared/client-store";
import {
  formatDateTime,
  openPaperDetail,
} from "../shared/session-store";
import {
  getVisiblePapers,
  setPaperFormStatus,
  setPaperSearch,
  shouldOfferBrowserFetchFallback,
  submitPaper,
  setPaperFormSourceUrl,
  setPaperFormRawHtml,
} from "./catalog-store";
import type { ClientState, Paper } from "../shared/types";

export function CatalogLibraryView() {
  const snapshot = useClientState() as ClientState;

  return (
    <section id="library-view" className="grid lg:grid-cols-[minmax(360px,1.7fr)_12px_minmax(280px,0.95fr)] grid-cols-1 gap-6 items-start min-h-0">
      <CatalogPaperList snapshot={snapshot} />

      <button
        className="relative self-stretch w-full min-w-0 p-0 border-0 rounded-full bg-transparent cursor-col-resize touch-none hidden lg:block group"
        type="button"
        data-resizer="left"
        aria-label="调整左侧栏宽度"
        aria-orientation="vertical"
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full bg-gradient-to-b from-accent/10 via-accent/30 to-accent/10 transition-all group-hover:via-accent/50 group-hover:scale-x-125"></div>
      </button>

      <CatalogUploadPanel snapshot={snapshot} />
    </section>
  );
}

function CatalogUploadPanel({ snapshot }: { snapshot: ClientState }) {
  const rawHtmlRef = useRef<HTMLTextAreaElement>(null);
  const { sourceUrl, rawHtml } = snapshot.catalog.paperForm;

  useEffect(() => {
    if (!snapshot.auth.currentUser) {
      setPaperFormSourceUrl("");
      setPaperFormRawHtml("");
    }
  }, [snapshot.auth.currentUser]);

  const hasSourceUrl = Boolean(sourceUrl.trim());
  const isSubmitDisabled =
    !snapshot.auth.serverReady || !snapshot.auth.currentUser || snapshot.catalog.isSavingPaper;

  async function handleSubmit(event: Event) {
    event.preventDefault();

    if (!sourceUrl.trim()) {
      return;
    }

    try {
      const savedPaper = await submitPaper({ sourceUrl, rawHtml });
      setPaperFormSourceUrl("");
      setPaperFormRawHtml("");
      openPaperDetail(savedPaper.id);
    } catch (error) {
      const latestStatus = getClientState().catalog.paperFormStatus;

      if (!rawHtml.trim() && shouldOfferBrowserFetchFallback(getErrorMessage(error, latestStatus))) {
        rawHtmlRef.current?.focus();
        window.alert(
          [
            getErrorMessage(error, "抓取失败"),
            "",
            "请点击“在浏览器打开文章网址”，在你自己的浏览器完成验证后，右键“查看页面源代码”，将 HTML 源码复制粘贴到输入框后再上传。",
            "如果文章来自 ScienceDirect，系统会自动尝试使用内置 Elsevier API 抓取全文 XML。",
          ].join("\n")
        );
        return;
      }

      window.alert(latestStatus || getErrorMessage(error, "抓取失败"));
    }
  }

  function handleOpenSourceUrlClick() {
    if (!sourceUrl.trim()) {
      setPaperFormStatus("请先填写文献网址");
      return;
    }

    let normalizedSourceUrl = "";

    try {
      normalizedSourceUrl = new URL(sourceUrl).toString();
    } catch (error) {
      setPaperFormStatus("请输入有效的网址");
      return;
    }

    const openedWindow = window.open(normalizedSourceUrl, "_blank");

    if (openedWindow) {
      try {
        openedWindow.opener = null;
        openedWindow.focus?.();
      } catch (error) {
        // Ignore cross-window focus issues and keep the guidance in PaperShare.
      }

      setPaperFormStatus(
        "已在你的浏览器打开原文。完成验证并进入论文正文后，请把“查看页面源代码”的 HTML 粘贴到上方，再点“抓取并保存”。"
      );
      return;
    }

    rawHtmlRef.current?.focus();
    setPaperFormStatus(
      "浏览器拦截了新窗口，请允许弹窗后重试，或手动打开该网址并把页面源代码粘贴到上方。"
    );
  }

  return (
    <aside className="flex flex-col gap-4 min-h-0 max-h-none overflow-visible lg:sticky lg:top-4">
      <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
        <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
          <h2 className="m-0 text-lg font-bold">上传新文章</h2>
          <span id="paper-form-status" className="text-muted text-[13px]">
            {snapshot.catalog.paperFormStatus}
          </span>
        </div>

        <form id="paper-form" className="grid gap-3" onSubmit={handleSubmit}>
          <label className="grid gap-2">
            <span className="text-[13px] text-muted">（必填）文章网址</span>
            <input
              id="paper-source-url"
              className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
              name="sourceUrl"
              type="url"
              placeholder="https://example.org/paper"
              value={sourceUrl}
              onInput={(event) => setPaperFormSourceUrl(event.currentTarget.value)}
              required
            />
          </label>

          <p className="m-0 text-muted leading-relaxed text-sm">
            开放获取的文章只需输入网址就可以直接抓取，如Nature系列、EGU系列。
          </p>

          <p className="m-0 text-muted leading-relaxed text-sm">
            Elsevier系列：如果管理员配置了API密钥，则用户只需输入网址，系统通过API获取。
          </p>

          <label className="grid gap-2">
            <span className="text-[13px] text-muted">（选填）Wiley等需要登录或人机验证的文章，请额外将页面源代码粘贴到下方输入框里。</span>
            <textarea
              id="paper-raw-html"
              className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none resize-y min-h-[120px]"
              ref={rawHtmlRef}
              name="rawHtml"
              rows={5}
              placeholder="遇到 Wiley 等需要人机验证的网站时，先在浏览器打开文章网址并完成登录验证，在网页右键，点击“查看页面源代码”，ctrl+A全选，ctrl+C复制。ctrl+V粘贴到这里。"
              value={rawHtml}
              onInput={(event) => setPaperFormRawHtml(event.currentTarget.value)}
            ></textarea>
          </label>

          <div className="flex flex-wrap gap-2.5 items-stretch">
            <button
              id="open-source-url-button"
              className="flex-1 min-h-[48px] border border-[rgba(121,92,55,0.2)] rounded-full px-4 bg-white/70 text-text transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50"
              type="button"
              onClick={handleOpenSourceUrlClick}
              disabled={!hasSourceUrl || snapshot.catalog.isSavingPaper}
            >
              在浏览器打开文章网址
            </button>
          </div>

          <button
            id="save-paper-button"
            className="w-full mt-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c]"
            type="submit"
            disabled={isSubmitDisabled}
          >
            抓取并上传
          </button>
        </form>
      </section>
    </aside>
  );
}

function CatalogPaperList({ snapshot }: { snapshot: ClientState }) {
  const papers = snapshot.papers.items;
  const visiblePapers = getVisiblePapers(papers, snapshot.catalog.searchTerm);

  return (
    <section className="flex flex-col gap-4 min-h-0">
      <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
        <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
          <h2 className="m-0 text-lg font-bold">文章和讨论列表</h2>
          <span id="paper-count" className="text-text font-semibold text-[17px]">
            {`${visiblePapers.length} / ${papers.length} 篇`}
          </span>
        </div>

        <p className="m-0 mb-3 text-muted leading-relaxed text-sm">文献条目按活动时间最近排序。点击文献条目可进入新的阅读与批注页面。</p>

        <label className="grid gap-2 mb-3">
          <input
            id="paper-search-input"
            className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
            type="search"
            placeholder="按标题、作者、摘要、关键词、上传人搜索"
            value={snapshot.catalog.searchTerm}
            onInput={(event) => setPaperSearch(event.currentTarget.value)}
          />
        </label>

        {!papers.length ? (
          <div id="paper-list" className="grid gap-2.5 text-muted leading-relaxed">
            storage 文件夹中还没有文献。
          </div>
        ) : !visiblePapers.length ? (
          <div id="paper-list" className="grid gap-2.5 text-muted leading-relaxed">
            没有匹配的文献，请换个关键词试试。
          </div>
        ) : (
          <div id="paper-list" className="grid gap-2.5">
            {visiblePapers.map((paper) => (
              <CatalogPaperListItem key={paper.id} paper={paper} />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function CatalogPaperListItem({ paper }: { paper: Paper }) {
  const creatorText = paper.created_by_username ? `上传者：${paper.created_by_username}` : "上传者未知";
  const latestSpeakerText = paper.latestSpeakerUsername || "暂无";
  const latestSpeechText = paper.latestSpeechAt ? formatDateTime(paper.latestSpeechAt) : "暂无";
  const uploadTimeText = formatDateTime(paper.createdAt);

  return (
    <button
      className="w-full min-w-0 text-left p-3.5 border border-[rgba(121,92,55,0.14)] rounded-2xl bg-white/74 transition-all hover:-translate-y-0.5 hover:shadow-md hover:bg-white active:scale-[0.98] group"
      type="button"
      data-paper-id={paper.id}
      onClick={() => openPaperDetail(paper.id)}
    >
      <strong className="block mb-2 min-w-0 group-hover:text-accent transition-colors">{truncate(paper.title || "未命名文献", 90)}</strong>
      <span className="block text-muted text-[13px] leading-relaxed">{truncate(paper.authors || "未填写作者", 90)}</span>
      <span className="block text-muted text-[13px] leading-relaxed font-medium">{truncate(paper.journal || "未填写来源", 90)}</span>
      <span className="block text-muted text-[13px] leading-relaxed">{creatorText}</span>
      <span className="block text-muted text-[13px] leading-relaxed mt-1">
        发言 <span className="text-text font-bold">{paper.speechCount || 0}</span> 条 · 最近 <span className="text-text font-bold">{latestSpeakerText}</span> · {latestSpeechText}
      </span>
      <span className="block text-muted text-[12px] leading-relaxed mt-1 opacity-70">上传于 {uploadTimeText}</span>
    </button>
  );
}

function truncate(value: string | undefined | null, maxLength: number) {
  const normalizedValue = String(value || "");

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
