import { useEffect, useRef } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import type { JSX } from "preact";
import {
  useClientState,
} from "../shared/client-store";
import { navigateToLibraryIndex } from "../shared/session-store";
import {
  handleDetailHashChange,
  initializeDetailPage,
  setLibraryPanel,
  setPendingSelection,
  selectAnnotationThread,
} from "./detail-store";
import {
  capturePendingSelection,
  installArticleImageFallbacks,
  renderArticleMath,
  restoreAnnotationHighlights,
} from "./detail-helpers";
import {
  getTopLevelDiscussions,
} from "../shared/speech-helpers";
import { ClientState, Paper } from "../shared/types";

// Import extracted components - Using lazy loading for sidebar components
import { PaperMetaCard } from "./components/PaperMetaCard";
const AnnotationComposer = lazy(() => import("./components/AnnotationComposer").then(m => ({ default: m.AnnotationComposer })));
const AnnotationList = lazy(() => import("./components/AnnotationList").then(m => ({ default: m.AnnotationList })));
const AnnotationDetail = lazy(() => import("./components/AnnotationDetail").then(m => ({ default: m.AnnotationDetail })));
const DiscussionComposer = lazy(() => import("./components/DiscussionComposer").then(m => ({ default: m.DiscussionComposer })));
const DiscussionList = lazy(() => import("./components/DiscussionList").then(m => ({ default: m.DiscussionList })));
const DiscussionDetail = lazy(() => import("./components/DiscussionDetail").then(m => ({ default: m.DiscussionDetail })));

function SidebarLoading() {
  return (
    <div className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
      <div className="text-muted leading-relaxed">正在加载侧边栏...</div>
    </div>
  );
}

export function DetailLibraryView() {
  const snapshot = useClientState() as ClientState;
  const detail = snapshot.detail;
  const annotationRootRef = useRef<HTMLDivElement>(null);
  const articleRootRef = useRef<HTMLElement>(null);
  const annotationDetailRef = useRef<HTMLDivElement>(null);
  const discussionDetailRef = useRef<HTMLDivElement>(null);
  const lastAnnotationNavigationRef = useRef("");
  const lastDiscussionNavigationRef = useRef("");

  useEffect(() => {
    void initializeDetailPage();

    function handleHashChange() {
      void handleDetailHashChange();
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (!annotationRootRef.current) {
      return;
    }

    restoreAnnotationHighlights(annotationRootRef.current, detail.annotations, {
      pendingSelection: detail.pendingSelection,
      activeAnnotationId: detail.selectedAnnotationId,
    });
  }, [
    detail.annotations,
    detail.pendingSelection,
    detail.selectedAnnotationId,
    detail.articleHtml,
    detail.selectedPaperId,
    detail.libraryPanel,
  ]);

  useEffect(() => {
    if (!articleRootRef.current) {
      return;
    }

    void renderArticleMath(articleRootRef.current);
    installArticleImageFallbacks(articleRootRef.current, detail.selectedPaper?.sourceUrl || "");
  }, [detail.articleHtml, detail.selectedPaper?.sourceUrl, detail.libraryPanel]);

  useEffect(() => {
    if (detail.libraryPanel !== "reader") {
      return;
    }

    const nextNavigationKey = [
      detail.selectedPaperId,
      detail.annotationNavigationTargetId,
      detail.selectedReplyId,
    ].join("::");

    if (!nextNavigationKey || lastAnnotationNavigationRef.current === nextNavigationKey) {
      return;
    }

    const highlight = detail.annotationNavigationTargetId
      ? (annotationRootRef.current?.querySelector(
          `[data-annotation-id="${detail.annotationNavigationTargetId}"]`
        ) as HTMLElement)
      : null;
    const listItem = detail.annotationNavigationTargetId
      ? (document.querySelector(`[data-annotation-list-id="${detail.annotationNavigationTargetId}"]`) as HTMLElement)
      : null;
    const replyItem = detail.selectedReplyId
      ? (annotationDetailRef.current?.querySelector(`[data-reply-id="${detail.selectedReplyId}"]`) as HTMLElement)
      : null;

    scrollIntoViewIfPossible(highlight, {
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    scrollIntoViewIfPossible(listItem, {
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
    scrollIntoViewIfPossible(replyItem, {
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
    scrollIntoViewIfPossible(annotationDetailRef.current, {
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
    lastAnnotationNavigationRef.current = nextNavigationKey;
  }, [
    detail.libraryPanel,
    detail.selectedPaperId,
    detail.annotationNavigationTargetId,
    detail.selectedReplyId,
    detail.annotations,
  ]);

  useEffect(() => {
    if (detail.libraryPanel !== "discussion") {
      return;
    }

    const nextNavigationKey = [
      detail.selectedPaperId,
      detail.discussionNavigationTargetId,
      detail.selectedDiscussionReplyId,
    ].join("::");

    if (!nextNavigationKey || lastDiscussionNavigationRef.current === nextNavigationKey) {
      return;
    }

    const listItem = detail.discussionNavigationTargetId
      ? (document.querySelector(`[data-discussion-id="${detail.discussionNavigationTargetId}"]`) as HTMLElement)
      : null;
    const replyItem = detail.selectedDiscussionReplyId
      ? (discussionDetailRef.current?.querySelector(
          `[data-discussion-reply-id="${detail.selectedDiscussionReplyId}"]`
        ) as HTMLElement)
      : null;

    scrollIntoViewIfPossible(listItem, {
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
    scrollIntoViewIfPossible(replyItem, {
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
    scrollIntoViewIfPossible(discussionDetailRef.current, {
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
    lastDiscussionNavigationRef.current = nextNavigationKey;
  }, [
    detail.libraryPanel,
    detail.selectedPaperId,
    detail.discussionNavigationTargetId,
    detail.selectedDiscussionReplyId,
    detail.discussions,
  ]);

  function handleCaptureSelection() {
    if (detail.libraryPanel !== "reader") {
      return;
    }

    const selection = capturePendingSelection(annotationRootRef.current as HTMLDivElement);

    if (selection) {
      setPendingSelection(selection);
    }
  }

  if (snapshot.auth.currentUser?.mustChangePassword) {
    return (
      <main id="app-content" className="min-h-0">
        <button
          id="back-to-library-button"
          className="max-w-full border border-[rgba(121,92,55,0.2)] rounded-full px-4 py-2 bg-white/70 text-text transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 mb-4"
          type="button"
          onClick={navigateToLibraryIndex}
        >
          ←返回文章和讨论列表
        </button>
        <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
          <div className="text-muted leading-relaxed">
            当前账号需要先回到目录页修改密码，修改完成后再查看文献与讨论。
          </div>
        </section>
      </main>
    );
  }

  return (
    <main id="app-content" className={`min-h-0${snapshot.auth.currentUser ? "" : " hidden"}`}>
      <button
        id="back-to-library-button"
        className="max-w-full border border-[rgba(121,92,55,0.2)] rounded-full px-4 py-2 bg-white/70 text-text transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 mb-4"
        type="button"
        onClick={navigateToLibraryIndex}
      >
        ←返回文章和讨论列表
      </button>
      <section id="library-view" className="grid lg:grid-cols-[minmax(360px,1.7fr)_12px_minmax(280px,0.95fr)] grid-cols-1 gap-6 items-start min-h-0">
        <div className="lg:col-span-3 w-full">
          <div id="library-panel-tabs" className="flex items-center justify-center flex-wrap gap-2.5 p-1.5 border border-[rgba(121,92,55,0.14)] rounded-full bg-[#fffdf8]/94 w-full" role="tablist" aria-label="阅读区切换">
            <button
              id="library-panel-reader-button"
              className={`flex items-center justify-center min-h-[40px] px-[18px] border-0 rounded-full flex-1 transition-all ${
                detail.libraryPanel !== "discussion" ? "bg-accent text-white shadow-md" : "bg-transparent text-muted hover:bg-accent/5"
              }`}
              type="button"
              role="tab"
              aria-selected={detail.libraryPanel !== "discussion"}
              onClick={() => setLibraryPanel("reader")}
            >
              阅读与批注
            </button>
            <button
              id="library-panel-discussion-button"
              className={`flex items-center justify-center min-h-[40px] px-[18px] border-0 rounded-full flex-1 transition-all ${
                detail.libraryPanel === "discussion" ? "bg-accent text-white shadow-md" : "bg-transparent text-muted hover:bg-accent/5"
              }`}
              type="button"
              role="tab"
              aria-selected={detail.libraryPanel === "discussion"}
              onClick={() => setLibraryPanel("discussion")}
            >
              讨论板
              <span id="discussion-count" className={`text-[13px] ml-1 ${detail.libraryPanel === "discussion" ? "text-white/80" : "text-muted"}`}>
                （{getTopLevelDiscussions(detail.discussions).length}）
              </span>
            </button>
          </div>
        </div>

        {detail.libraryPanel !== "discussion" ? (
          <>
            <section className="min-h-0">
              <div
                id="annotation-root"
                ref={annotationRootRef}
                className="p-9.5 lg:px-[min(3vw,48px)] border border-paper-border rounded-[24px] bg-paper shadow-custom"
                onMouseUp={handleCaptureSelection}
                onKeyUp={handleCaptureSelection}
                onClick={(event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
                  const target = event.target instanceof Element ? event.target : null;
                  const highlight = target?.closest("[data-annotation-id]") as HTMLElement | null;

                  if (highlight?.dataset?.annotationId) {
                    selectAnnotationThread(highlight.dataset.annotationId);
                  }
                }}
              >
                <PaperMetaCard snapshot={snapshot} />
                <article
                  id="article-root"
                  ref={articleRootRef}
                  className="text-[18px] leading-[1.9] min-w-0 break-words"
                  data-annotation-scope="body"
                  dangerouslySetInnerHTML={{ __html: detail.articleHtml || renderEmptyArticleState(detail.selectedPaper) }}
                />
              </div>
            </section>

            <button
              className="relative self-stretch w-full min-w-0 p-0 border-0 rounded-full bg-transparent cursor-col-resize touch-none hidden lg:block group"
              type="button"
              data-resizer="right"
              aria-label="调整右侧栏宽度"
              aria-orientation="vertical"
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full bg-gradient-to-b from-accent/10 via-accent/30 to-accent/10 transition-all group-hover:via-accent/50 group-hover:scale-x-125"></div>
            </button>

            <aside className="grid gap-4 min-h-0 max-h-none overflow-visible lg:sticky lg:top-4 lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-accent/20">
              <Suspense fallback={<SidebarLoading />}>
                <AnnotationComposer snapshot={snapshot} />
                <AnnotationList snapshot={snapshot} />
                <AnnotationDetail snapshot={snapshot} detailRef={annotationDetailRef} />
              </Suspense>
            </aside>
          </>
        ) : (
          <section id="discussion-board" className="lg:col-span-3 grid gap-4 min-h-0 max-h-none overflow-visible">
            <Suspense fallback={<SidebarLoading />}>
              <DiscussionComposer snapshot={snapshot} />
              <DiscussionList snapshot={snapshot} />
              <DiscussionDetail snapshot={snapshot} detailRef={discussionDetailRef} />
            </Suspense>
          </section>
        )}
      </section>
    </main>
  );
}

function renderEmptyArticleState(selectedPaper: Paper | null) {
  if (selectedPaper) {
    return '<div class="text-muted leading-relaxed">当前文献没有可展示的网页快照。</div>';
  }

  return '<div class="text-muted leading-relaxed">当前还没有选中文献。抓取成功后，文献详情和网页快照会从运行时存储目录加载。</div>';
}

function scrollIntoViewIfPossible(element: HTMLElement | null, options: ScrollIntoViewOptions) {
  if (typeof element?.scrollIntoView !== "function") {
    return;
  }

  element.scrollIntoView(options);
}
