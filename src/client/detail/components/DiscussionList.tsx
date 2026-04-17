import { memo } from "preact/compat";
import type { ClientState } from "../../shared/types";
import { formatDateTime } from "../../shared/session-store";
import {
  getTopLevelDiscussions,
  getRepliesForDiscussion,
  getRecordNoteDisplay,
} from "../../shared/speech-helpers";
import { selectDiscussionThread } from "../detail-store";

export const DiscussionList = memo(({ snapshot }: { snapshot: ClientState }) => {
  const detail = snapshot.detail;
  const discussions = getTopLevelDiscussions(detail.discussions);

  return (
    <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
      <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
        <h3 className="m-0 text-lg font-bold">当前文献讨论</h3>
      </div>
      {!discussions.length ? (
        <div id="discussion-list" className="grid gap-2.5 text-muted leading-relaxed">
          还没有讨论。
        </div>
      ) : (
        <div id="discussion-list" className="grid gap-2.5">
          {discussions.map((discussion) => {
            const replies = getRepliesForDiscussion(detail.discussions, discussion.id);

            return (
              <button
                key={discussion.id}
                type="button"
                className={`w-full min-w-0 text-left p-3.5 border border-[rgba(121,92,55,0.14)] rounded-2xl bg-white/74 transition-all hover:-translate-y-0.5 hover:shadow-md hover:bg-white active:scale-[0.98] group ${
                  detail.selectedDiscussionId === discussion.id ? "border-accent/40 bg-accent-soft" : ""
                }`}
                data-discussion-id={discussion.id}
                onClick={() => selectDiscussionThread(discussion.id)}
              >
                <div className="w-full min-w-0 p-0 grid gap-1.5">
                  <div className="flex justify-between gap-3 items-start mb-2">
                    <strong className="group-hover:text-accent transition-colors">{discussion.created_by_username || "未知用户"}</strong>
                    <time className="text-muted text-[12px] whitespace-nowrap">{formatDateTime(discussion.created_at)}</time>
                  </div>
                  <p className="m-0 text-text text-[14px] leading-relaxed" style={{ whiteSpace: "pre-wrap" }}>
                    {truncate(getRecordNoteDisplay(discussion), 120)}
                  </p>
                  {discussion.attachments?.length ? (
                    <span className="inline-flex items-center justify-center w-fit min-h-[28px] px-2.5 rounded-full text-accent bg-accent/8 border border-accent/12 text-[12px] font-bold">附件 {discussion.attachments.length} 个</span>
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
