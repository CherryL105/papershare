import { memo } from "preact/compat";
import type { ClientState } from "../../shared/types";
import type { RefObject } from "preact";
import { formatDateTime } from "../../shared/session-store";
import {
  getTopLevelAnnotations,
  getRepliesForAnnotation,
  getAnnotationScopeLabel,
  getRecordNoteDisplay,
  canMutateRecord,
  getReplyRelationText,
} from "../../shared/speech-helpers";
import {
  startDetailEdit,
  deleteSelectedAnnotation,
  saveDetailEdit,
  cancelDetailEdit,
  selectAnnotationReply,
  deleteAnnotationReply,
  setDetailComposerDraft,
  addDetailComposerAttachments,
  removeDetailComposerAttachment,
  clearDetailComposerAttachments,
  saveAnnotationReply,
} from "../detail-store";
import { AttachmentComposer } from "./AttachmentComponents";
import { RecordDisplay, ThreadReplyCard, SpeechInlineEditor } from "./SpeechSharedComponents";

export const AnnotationDetail = memo(({
  snapshot,
  detailRef,
}: {
  snapshot: ClientState;
  detailRef: RefObject<HTMLDivElement>;
}) => {
  const detail = snapshot.detail;
  const topLevelAnnotations = getTopLevelAnnotations(detail.annotations);
  const selectedThread =
    topLevelAnnotations.find(
      (annotation) => annotation.id === detail.selectedAnnotationId
    ) || null;
  const replies = selectedThread ? getRepliesForAnnotation(detail.annotations, selectedThread.id) : [];
  const selectedReply =
    replies.find((reply) => reply.id === detail.selectedReplyId) ||
    detail.annotations.find((annotation) => annotation.id === detail.selectedReplyId) ||
    null;
  const activeReplyTarget = selectedReply || selectedThread;
  const canDeleteThread = canMutateRecord(selectedThread, snapshot.auth.currentUser);
  const threadEditState = detail.annotationEditState;

  return (
    <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
      <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
        <h3 className="m-0 text-lg font-bold">批注详情</h3>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            id="edit-annotation-button"
            className="inline-flex items-center justify-center min-h-[36px] px-3 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text text-sm transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50"
            type="button"
            disabled={!selectedThread || !canDeleteThread}
            onClick={() => startDetailEdit("annotation", selectedThread?.id as string, "annotation")}
          >
            编辑
          </button>
          <button
            id="delete-annotation-button"
            className="inline-flex items-center justify-center min-h-[36px] px-3 border border-[rgba(139,30,45,0.18)] rounded-full text-[#8b1e2d] bg-white/60 text-sm transition-all hover:bg-[rgba(139,30,45,0.08)] active:scale-95 disabled:opacity-40"
            type="button"
            disabled={!selectedThread || !canDeleteThread}
            onClick={async () => {
              if (!selectedThread || !window.confirm("确定删除该批注吗？")) {
                return;
              }

              try {
                await deleteSelectedAnnotation();
              } catch (error) {
                window.alert(error instanceof Error ? error.message : "删除批注失败，请稍后再试。");
              }
            }}
          >
            删除
          </button>
        </div>
      </div>
      {!selectedThread ? (
        <div id="annotation-detail" className="mt-3 p-3.5 rounded-2xl bg-white/72 border border-[rgba(121,92,55,0.12)] min-h-[180px] text-muted leading-relaxed" ref={detailRef}>
          点击高亮或右侧列表项后，这里会显示批注内容与讨论线程。
        </div>
      ) : (
        <div id="annotation-detail" className="mt-3 p-3.5 rounded-2xl bg-white/72 border border-[rgba(121,92,55,0.12)] overflow-auto min-h-[180px]" ref={detailRef}>
          {threadEditState.targetId === selectedThread.id && threadEditState.targetType === "annotation" ? (
            <SpeechInlineEditor
              kind="annotation"
              editState={threadEditState}
              saveButtonLabel="保存批注"
              onSave={() => saveDetailEdit("annotation")}
              onCancel={() => cancelDetailEdit("annotation")}
            />
          ) : (
            <RecordDisplay
              record={selectedThread}
              relationText={`${getAnnotationScopeLabel(selectedThread.target_scope)} · “${selectedThread.exact}”`}
            />
          )}
          {replies.length ? (
            <div className="grid gap-3 mt-4">
              {replies.map((reply) => (
                <ThreadReplyCard
                  key={reply.id}
                  active={detail.selectedReplyId === reply.id}
                  dataAttributeName="data-reply-id"
                  dataAttributeValue={reply.id}
                  onSelect={() => selectAnnotationReply(reply.id)}
                  onEdit={
                    canMutateRecord(reply, snapshot.auth.currentUser)
                      ? () => startDetailEdit("annotation", reply.id, "reply")
                      : undefined
                  }
                  onDelete={
                    canMutateRecord(reply, snapshot.auth.currentUser)
                      ? async () => {
                          if (!window.confirm("确定删除这条回复吗？")) {
                            return;
                          }

                          try {
                            await deleteAnnotationReply(reply.id);
                          } catch (error) {
                            window.alert(error instanceof Error ? error.message : "删除回复失败，请稍后再试。");
                          }
                        }
                      : undefined
                  }
                >
                  {threadEditState.targetId === reply.id && threadEditState.targetType === "reply" ? (
                    <SpeechInlineEditor
                      kind="annotation"
                      editState={threadEditState}
                      saveButtonLabel="保存回复"
                      onSave={() => saveDetailEdit("annotation")}
                      onCancel={() => cancelDetailEdit("annotation")}
                    />
                  ) : (
                    <RecordDisplay record={reply} relationText={getReplyRelationText(detail.annotations, reply)} compact={true} />
                  )}
                </ThreadReplyCard>
              ))}
            </div>
          ) : null}
        </div>
      )}
      <div id="reply-panel" className="grid gap-3 mt-4">
        <p id="reply-context" className="m-0 text-muted leading-relaxed text-sm">
          {activeReplyTarget
            ? `当前将回复 ${activeReplyTarget.created_by_username || "未知用户"} 的发言。`
            : "选择一条批注后可在这里继续讨论。"}
        </p>
        <textarea
          id="reply-input"
          className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none min-h-[80px] resize-y"
          rows={2}
          placeholder="例如：我同意这条判断，补充一个方法上的解释。"
          value={detail.replyComposer.draft}
          onInput={(event) => setDetailComposerDraft("reply", event.currentTarget.value)}
          disabled={!selectedThread}
        ></textarea>
        <AttachmentComposer
          idPrefix="reply"
          files={detail.replyComposer.attachments}
          disabled={!selectedThread}
          onAddFiles={(files) => addDetailComposerAttachments("reply", files)}
          onRemoveFile={(index) => removeDetailComposerAttachment("reply", index)}
          onClear={() => clearDetailComposerAttachments("reply")}
        />
        <button
          id="add-reply-button"
          className="w-full mt-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c]"
          type="button"
          disabled={!selectedThread || detail.isSavingReply}
          onClick={async () => {
            try {
              await saveAnnotationReply();
            } catch (error) {
              window.alert(error instanceof Error ? error.message : "回复失败，请稍后重试。");
            }
          }}
        >
          回复当前批注
        </button>
      </div>
    </section>
  );
});
