import { memo } from "preact/compat";
import type { ClientState } from "../../shared/types";
import { formatDateTime } from "../../shared/session-store";
import {
  getTopLevelAnnotations,
  getRepliesForAnnotation,
  getAnnotationScopeLabel,
  getRecordNoteDisplay,
  isReplyAnnotation,
} from "../../shared/speech-helpers";
import { selectAnnotationThread, clearSelectedPaperAnnotations } from "../detail-store";

export const AnnotationList = memo(({ snapshot }: { snapshot: ClientState }) => {
  const detail = snapshot.detail;
  const topLevelAnnotations = getTopLevelAnnotations(detail.annotations);
  const replyCount = detail.annotations.filter((annotation) => isReplyAnnotation(annotation)).length;

  return (
    <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
      <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
        <h3 className="m-0 text-lg font-bold">当前文献批注</h3>
        <span id="annotation-count" className="text-muted text-[13px]">
          {`${topLevelAnnotations.length} 条批注 / ${replyCount} 条回复`}
        </span>
        <button
          id="clear-storage-button"
          className="inline-flex items-center justify-center min-h-[36px] px-3 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text text-sm transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50"
          type="button"
          disabled={!snapshot.auth.currentUser || !detail.selectedPaper || !detail.annotations.length}
          onClick={async () => {
            if (!window.confirm("确定要清空你在当前文献下创建的全部批注吗？")) {
              return;
            }

            try {
              await clearSelectedPaperAnnotations();
            } catch (error) {
              window.alert(error instanceof Error ? error.message : "清空批注失败，请稍后再试。");
            }
          }}
        >
          清空我在当前文献的批注
        </button>
      </div>
      {!topLevelAnnotations.length ? (
        <div id="annotation-list" className="grid gap-2.5 text-muted leading-relaxed">
          还没有批注。
        </div>
      ) : (
        <div id="annotation-list" className="grid gap-2.5">
          {topLevelAnnotations.map((annotation) => {
            const replies = getRepliesForAnnotation(detail.annotations, annotation.id);

            return (
              <button
                key={annotation.id}
                type="button"
                className={`w-full min-w-0 text-left p-3.5 border border-[rgba(121,92,55,0.14)] rounded-2xl bg-white/74 transition-all hover:-translate-y-0.5 hover:shadow-md hover:bg-white active:scale-[0.98] group ${
                  detail.selectedAnnotationId === annotation.id ? "border-accent/40 bg-accent-soft" : ""
                }`}
                data-annotation-id={annotation.id}
                data-annotation-list-id={annotation.id}
                onClick={() => selectAnnotationThread(annotation.id)}
              >
                <div className="w-full min-w-0 p-0 grid gap-1.5">
                  <div className="flex justify-between gap-3 items-start mb-2">
                    <strong className="group-hover:text-accent transition-colors">{annotation.created_by_username || "未知用户"}</strong>
                    <time className="text-muted text-[12px] whitespace-nowrap">{formatDateTime(annotation.created_at)}</time>
                  </div>
                  <span className="text-accent text-[13px] leading-relaxed">
                    {getAnnotationScopeLabel(annotation.target_scope)} · “{truncate(annotation.exact || "", 56)}”
                  </span>
                  <p className="m-0 text-text text-[14px] leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>
                    {truncate(getRecordNoteDisplay(annotation), 120)}
                  </p>
                  {annotation.attachments?.length ? (
                    <span className="inline-flex items-center justify-center w-fit min-h-[28px] px-2.5 rounded-full text-accent bg-accent/8 border border-accent/12 text-[12px] font-bold">附件 {annotation.attachments.length} 个</span>
                  ) : null}
                  {replies.length ? (
                    <span className="text-text font-bold text-sm">回复 {replies.length} 条</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
});

function truncate(value: string | undefined | null, maxLength: number) {
  const normalizedValue = String(value || "");

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...`;
}
