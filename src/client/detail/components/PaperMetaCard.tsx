import { memo } from "preact/compat";
import type { ClientState } from "../../shared/types";
import { canMutateRecord } from "../../shared/speech-helpers";
import { deleteSelectedPaper } from "../detail-store";

export const PaperMetaCard = memo(({ snapshot }: { snapshot: ClientState }) => {
  const paper = snapshot.detail.selectedPaper;
  const currentUser = snapshot.auth.currentUser;
  const canDelete = paper && canMutateRecord(paper, currentUser);

  return (
    <div className="pb-7 mb-7 border-b border-[rgba(121,92,55,0.14)]">
      <div className="flex justify-between items-start gap-4 flex-col lg:flex-row">
        <div>
          <p id="paper-journal" className="m-0 text-muted leading-relaxed">
            {paper?.journal || "请选择一篇文献"}
          </p>
          <h2 id="paper-title" className="m-2.5 mb-3 text-[clamp(28px,3vw,42px)] leading-[1.15] font-bold text-text" data-annotation-scope="title">
            {paper?.title || "返回列表选择文献后开始阅读"}
          </h2>
        </div>
        <div className="flex items-center justify-start lg:justify-end flex-wrap gap-3">
          <a
            id="source-link"
            className={`inline-flex items-center justify-center max-w-full min-h-[46px] px-[18px] border border-panel-border rounded-full text-accent no-underline bg-white/72 text-center transition-all hover:-translate-y-0.5 hover:bg-white${paper?.sourceUrl ? "" : " opacity-45 pointer-events-none"}`}
            href={paper?.sourceUrl || "#"}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!paper?.sourceUrl}
          >
            原文网址
          </a>
          <button
            id="delete-paper-button"
            className="inline-flex items-center justify-center min-h-[46px] px-4 border border-[rgba(139,30,45,0.18)] rounded-full text-[#8b1e2d] bg-white/60 transition-all hover:-translate-y-0.5 hover:bg-[rgba(139,30,45,0.08)] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            type="button"
            disabled={!canDelete}
            onClick={async () => {
              if (!paper || !window.confirm("确定删除该文献吗？")) {
                return;
              }

              try {
                await deleteSelectedPaper();
              } catch (error) {
                window.alert(error instanceof Error ? error.message : "删除文献失败，请稍后再试。");
              }
            }}
          >
            删除文献
          </button>
        </div>
      </div>
      <p id="paper-authors" className="m-0 leading-[1.7] text-text" data-annotation-scope="authors">
        {paper?.authors || ""}
      </p>
      <p id="paper-published" className="m-0 mt-2 text-muted leading-relaxed">
        {paper?.published ? `Published: ${paper.published}` : ""}
      </p>
      <p id="paper-owner" className="m-0 mt-2 text-muted leading-relaxed">
        {paper?.created_by_username ? `上传者：${paper.created_by_username}` : ""}
      </p>
      <p id="paper-abstract" className="m-0 mt-2 text-muted leading-relaxed" data-annotation-scope="abstract">
        {paper?.abstract ? `摘要：${paper.abstract}` : ""}
      </p>
      <div id="paper-keywords" className="flex flex-wrap gap-2 mt-4">
        {(paper?.keywords || []).map((keyword) => (
          <span key={keyword} className="inline-flex items-center min-h-[32px] px-3 rounded-full text-accent bg-accent-soft border border-accent/12 text-[13px]">
            {keyword}
          </span>
        ))}
      </div>
    </div>
  );
});
