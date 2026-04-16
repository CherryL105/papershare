import { useEffect, useRef, useState } from "preact/hooks";
import {
  formatDateTime,
  getClientState,
  getVisiblePapers,
  openPaperDetail,
  setPaperFormStatus,
  setPaperSearch,
  shouldOfferBrowserFetchFallback,
  submitPaper,
  useClientState,
} from "../shared/client-store.js";

export function CatalogLibraryView() {
  const snapshot = useClientState();

  return (
    <section id="library-view" className="content-grid is-catalog">
      <CatalogUploadPanel snapshot={snapshot} />

      <button
        className="pane-resizer"
        type="button"
        data-resizer="left"
        aria-label="调整左侧栏宽度"
        aria-orientation="vertical"
      ></button>

      <CatalogPaperList snapshot={snapshot} />
    </section>
  );
}

function CatalogUploadPanel({ snapshot }) {
  const rawHtmlRef = useRef(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [rawHtml, setRawHtml] = useState("");

  useEffect(() => {
    if (!snapshot.auth.currentUser) {
      setSourceUrl("");
      setRawHtml("");
    }
  }, [snapshot.auth.currentUser]);

  const hasSourceUrl = Boolean(sourceUrl.trim());
  const isSubmitDisabled =
    !snapshot.auth.serverReady || !snapshot.auth.currentUser || snapshot.catalog.isSavingPaper;

  async function handleSubmit(event) {
    event.preventDefault();

    if (!sourceUrl.trim()) {
      return;
    }

    try {
      const savedPaper = await submitPaper({ sourceUrl, rawHtml });
      setSourceUrl("");
      setRawHtml("");
      openPaperDetail(savedPaper.id);
    } catch (error) {
      const latestStatus = getClientState().catalog.paperFormStatus;

      if (!rawHtml.trim() && shouldOfferBrowserFetchFallback(error.message || latestStatus)) {
        rawHtmlRef.current?.focus();
        window.alert(
          [
            error.message || "抓取失败",
            "",
            "请点击“在浏览器打开文章网址”，在你自己的浏览器完成验证后，右键“查看页面源代码”，将 HTML 源码复制粘贴到输入框后再上传。",
            "如果文章来自 ScienceDirect，系统会自动尝试使用内置 Elsevier API 抓取全文 XML。",
          ].join("\n")
        );
        return;
      }

      window.alert(latestStatus || error.message || "抓取失败");
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
    <aside className="library-sidebar">
      <section className="panel">
        <div className="panel-header">
          <h2>上传新文章</h2>
          <span id="paper-form-status" className="status-pill">
            {snapshot.catalog.paperFormStatus}
          </span>
        </div>

        <form id="paper-form" className="paper-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>（必填）文章网址</span>
            <input
              id="paper-source-url"
              name="sourceUrl"
              type="url"
              placeholder="https://example.org/paper"
              value={sourceUrl}
              onInput={(event) => setSourceUrl(event.currentTarget.value)}
              required
            />
          </label>

          <p className="panel-tip">
            开放获取的文章只需输入网址就可以直接抓取，如Nature系列、EGU系列。
          </p>

          <p className="panel-tip">
            Elsevier系列：如果管理员配置了API密钥，则用户只需输入网址，系统通过API获取。
          </p>

          <label className="field">
            <span>（选填）Wiley等需要登录或人机验证的文章，请额外将页面源代码粘贴到下方输入框里。</span>
            <textarea
              id="paper-raw-html"
              ref={rawHtmlRef}
              name="rawHtml"
              rows="5"
              placeholder="遇到 Wiley 等需要人机验证的网站时，先在浏览器打开文章网址并完成登录验证，在网页右键，点击“查看页面源代码”，ctrl+A全选，ctrl+C复制。ctrl+V粘贴到这里。"
              value={rawHtml}
              onInput={(event) => setRawHtml(event.currentTarget.value)}
            ></textarea>
          </label>

          <div className="browser-fetch-actions">
            <button
              id="open-source-url-button"
              className="primary-button"
              type="button"
              onClick={handleOpenSourceUrlClick}
              disabled={!hasSourceUrl || snapshot.catalog.isSavingPaper}
            >
              在浏览器打开文章网址
            </button>
          </div>

          <button
            id="save-paper-button"
            className="primary-button"
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

function CatalogPaperList({ snapshot }) {
  const papers = snapshot.papers.items;
  const visiblePapers = getVisiblePapers(papers, snapshot.catalog.searchTerm);

  return (
    <section className="library-search">
      <section className="panel">
        <div className="panel-header">
          <h2>文章和讨论列表</h2>
          <span id="paper-count" className="annotation-count">
            {`${visiblePapers.length} / ${papers.length} 篇`}
          </span>
        </div>

        <p className="panel-tip">文献条目按活动时间最近排序。点击文献条目可进入新的阅读与批注页面。</p>

        <label className="field">
          <input
            id="paper-search-input"
            className="search-input"
            type="search"
            placeholder="按标题、作者、摘要、关键词、上传人搜索"
            value={snapshot.catalog.searchTerm}
            onInput={(event) => setPaperSearch(event.currentTarget.value)}
          />
        </label>

        {!papers.length ? (
          <div id="paper-list" className="paper-list empty-state">
            storage 文件夹中还没有文献。
          </div>
        ) : !visiblePapers.length ? (
          <div id="paper-list" className="paper-list empty-state">
            没有匹配的文献，请换个关键词试试。
          </div>
        ) : (
          <div id="paper-list" className="paper-list">
            {visiblePapers.map((paper) => (
              <CatalogPaperListItem key={paper.id} paper={paper} />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function CatalogPaperListItem({ paper }) {
  const creatorText = paper.created_by_username ? `上传者：${paper.created_by_username}` : "上传者未知";
  const latestSpeakerText = paper.latestSpeakerUsername || "暂无";
  const latestSpeechText = paper.latestSpeechAt ? formatDateTime(paper.latestSpeechAt) : "暂无";
  const uploadTimeText = formatDateTime(paper.createdAt || paper.created_at);

  return (
    <button
      className="paper-item"
      type="button"
      data-paper-id={paper.id}
      onClick={() => openPaperDetail(paper.id)}
    >
      <strong>{truncate(paper.title || "未命名文献", 90)}</strong>
      <span>{truncate(paper.authors || "未填写作者", 90)}</span>
      <span className="paper-item-journal">{truncate(paper.journal || "未填写来源", 90)}</span>
      <span>{creatorText}</span>
      <span className="paper-item-speech-meta">
        发言 {paper.speech_count || 0} 条 · 最近 {latestSpeakerText} · {latestSpeechText}
      </span>
      <span className="paper-item-uploaded-at">上传于 {uploadTimeText}</span>
    </button>
  );
}

function truncate(value, maxLength) {
  const normalizedValue = String(value || "");

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...`;
}
