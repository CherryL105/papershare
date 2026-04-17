import { memo } from "preact/compat";
import type { ClientState } from "../../shared/types";
import type { RefObject } from "preact";
import {
  getTopLevelDiscussions,
  getRepliesForDiscussion,
  canMutateRecord,
  getDiscussionReplyRelationText,
} from "../../shared/speech-helpers";
import {
  startDetailEdit,
  deleteSelectedDiscussion,
  saveDetailEdit,
  cancelDetailEdit,
  selectDiscussionReply,
  deleteDiscussionReply,
  setDetailComposerDraft,
  addDetailComposerAttachments,
  removeDetailComposerAttachment,
  clearDetailComposerAttachments,
  saveDiscussionReply,
} from "../detail-store";
import { AttachmentComposer } from "./AttachmentComponents";
import { RecordDisplay, ThreadReplyCard, SpeechInlineEditor } from "./SpeechSharedComponents";

export const DiscussionDetail = memo(({
  snapshot,
  detailRef,
}: {
  snapshot: ClientState;
  detailRef: RefObject<HTMLDivElement>;
}) => {
  const detail = snapshot.detail;
  const topLevelDiscussions = getTopLevelDiscussions(detail.discussions);
  const selectedThread =
    topLevelDiscussions.find(
      (discussion) => discussion.id === detail.selectedDiscussionId
    ) || null;
  const replies = selectedThread ? getRepliesForDiscussion(detail.discussions, selectedThread.id) : [];
  const selectedReply =
    replies.find((reply) => reply.id === detail.selectedDiscussionReplyId) ||
    detail.discussions.find((discussion) => discussion.id === detail.selectedDiscussionReplyId) ||
    null;
  const activeReplyTarget = selectedReply || selectedThread;
  const canDeleteThread = canMutateRecord(selectedThread, snapshot.auth.currentUser);
  const threadEditState = detail.discussionEditState;

  return (
    <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
      <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
        <h3 className="m-0 text-lg font-bold">讨论详情</h3>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            id="edit-discussion-button"
            className="inline-flex items-center justify-center min-h-[36px] px-3 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text text-sm transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50"
            type="button"
            disabled={!selectedThread || !canDeleteThread}
            onClick={() => startDetailEdit("discussion", selectedThread?.id as string, "discussion")}
          >
            编辑
          </button>
          <button
            id="delete-discussion-button"
            className="inline-flex items-center justify-center min-h-[36px] px-3 border border-[rgba(139,30,45,0.18)] rounded-full text-[#8b1e2d] bg-white/60 text-sm transition-all hover:bg-[rgba(139,30,45,0.08)] active:scale-95 disabled:opacity-40"
            type="button"
            disabled={!selectedThread || !canDeleteThread}
            onClick={async () => {
              if (!selectedThread || !window.confirm("确定删除该讨论吗？")) {
                return;
              }

              try {
                await deleteSelectedDiscussion();
              } catch (error) {
                window.alert(error instanceof Error ? error.message : "删除讨论失败，请稍后再试。");
              }
            }}
          >
            删除
          </button>
        </div>
      </div>
      {!selectedThread ? (
        <div id="discussion-detail" className="mt-3 p-3.5 rounded-2xl bg-white/72 border border-[rgba(121,92,55,0.12)] min-h-[180px] text-muted leading-relaxed" ref={detailRef}>
          点击列表项后，这里会显示讨论内容与回复线程。
        </div>
      ) : (
        <div id="discussion-detail" className="mt-3 p-3.5 rounded-2xl bg-white/72 border border-[rgba(121,92,55,0.12)] overflow-auto min-h-[180px]" ref={detailRef}>
          {threadEditState.targetId === selectedThread.id &&
          threadEditState.targetType === "discussion" ? (
            <SpeechInlineEditor
              kind="discussion"
              editState={threadEditState}
              saveButtonLabel="保存讨论"
              onSave={() => saveDetailEdit("discussion")}
              onCancel={() => cancelDetailEdit("discussion")}
            />
          ) : (
            <RecordDisplay record={selectedThread} />
          )}
          {replies.length ? (
            <div className="grid gap-3 mt-4">
              {replies.map((reply) => (
                <ThreadReplyCard
                  key={reply.id}
                  active={detail.selectedDiscussionReplyId === reply.id}
                  dataAttributeName="data-discussion-reply-id"
                  dataAttributeValue={reply.id}
                  onSelect={() => selectDiscussionReply(reply.id)}
                  onEdit={
                    canMutateRecord(reply, snapshot.auth.currentUser)
                      ? () => startDetailEdit("discussion", reply.id, "reply")
                      : undefined
                  }
                  onDelete={
                    canMutateRecord(reply, snapshot.auth.currentUser)
                      ? async () => {
                          if (!window.confirm("确定删除这条回复吗？")) {
                            return;
                          }

                          try {
                            await deleteDiscussionReply(reply.id);
                          } catch (error) {
                            window.alert(error instanceof Error ? error.message : "删除回复失败，请稍后再试。");
                          }
                        }
                      : undefined
                  }
                >
                  {threadEditState.targetId === reply.id && threadEditState.targetType === "reply" ? (
                    <SpeechInlineEditor
                      kind="discussion"
                      editState={threadEditState}
                      saveButtonLabel="保存回复"
                      onSave={() => saveDetailEdit("discussion")}
                      onCancel={() => cancelDetailEdit("discussion")}
                    />
                  ) : (
                    <RecordDisplay
                      record={reply}
                      relationText={getDiscussionReplyRelationText(detail.discussions, reply)}
                      compact={true}
                    />
                  )}
                </ThreadReplyCard>
              ))}
            </div>
          ) : null}
        </div>
      )}
      <div className="grid gap-3 mt-4">
        <p id="discussion-reply-context" className="m-0 text-muted leading-relaxed text-sm">
          {activeReplyTarget
            ? `当前将回复 ${activeReplyTarget.created_by_username || "未知用户"} 的讨论。`
            : "选择一条讨论后可在这里继续回复。"}
        </p>
        <textarea
          id="discussion-reply-input"
          className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none min-h-[80px] resize-y"
          rows={2}
          placeholder="例如：我赞同这个判断，再补充一个实验上的解释。"
          value={detail.discussionReplyComposer.draft}
          onInput={(event) => setDetailComposerDraft("discussionReply", event.currentTarget.value)}
          disabled={!selectedThread}
        ></textarea>
        <AttachmentComposer
          idPrefix="discussion-reply"
          files={detail.discussionReplyComposer.attachments}
          disabled={!selectedThread}
          onAddFiles={(files) => addDetailComposerAttachments("discussionReply", files)}
          onRemoveFile={(index) => removeDetailComposerAttachment("discussionReply", index)}
          onClear={() => clearDetailComposerAttachments("discussionReply")}
        />
        <button
          id="add-discussion-reply-button"
          className="w-full mt-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c]"
          type="button"
          disabled={!selectedThread || detail.isSavingDiscussionReply}
          onClick={async () => {
            try {
              await saveDiscussionReply();
            } catch (error) {
              window.alert(error instanceof Error ? error.message : "回复失败，请稍后重试。");
            }
          }}
        >
          回复当前讨论
        </button>
      </div>
    </section>
  );
});
