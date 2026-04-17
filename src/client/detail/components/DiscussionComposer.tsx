import { memo } from "preact/compat";
import type { ClientState } from "../../shared/types";
import {
  setDetailComposerDraft,
  addDetailComposerAttachments,
  removeDetailComposerAttachment,
  clearDetailComposerAttachments,
  saveDiscussion,
} from "../detail-store";
import { AttachmentComposer } from "./AttachmentComponents";

export const DiscussionComposer = memo(({ snapshot }: { snapshot: ClientState }) => {
  const detail = snapshot.detail;

  return (
    <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
      <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
        <h3 className="m-0 text-lg font-bold">发起讨论</h3>
        <span id="discussion-status" className="text-muted text-[13px]">
          {!snapshot.auth.currentUser
            ? "登录后可发布讨论"
            : !detail.selectedPaper
              ? "请选择文献"
              : detail.isSavingDiscussion
                ? "讨论发布中..."
                : "可发布讨论"}
        </span>
      </div>
      <p className="m-0 mb-3 text-muted leading-relaxed text-sm">讨论针对整篇文章，不需要选中文本。</p>
      <textarea
        id="discussion-input"
        className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none resize-y min-h-[80px]"
        rows={2}
        placeholder="例如：这篇文章的实验设计还有哪些可优化的地方？"
        value={detail.discussionComposer.draft}
        onInput={(event) => setDetailComposerDraft("discussion", event.currentTarget.value)}
        disabled={!detail.selectedPaper}
      ></textarea>
      <AttachmentComposer
        idPrefix="discussion"
        files={detail.discussionComposer.attachments}
        disabled={!detail.selectedPaper}
        onAddFiles={(files) => addDetailComposerAttachments("discussion", files)}
        onRemoveFile={(index) => removeDetailComposerAttachment("discussion", index)}
        onClear={() => clearDetailComposerAttachments("discussion")}
      />
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch mt-3">
        <button
          id="add-discussion-button"
          className="flex-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c] disabled:cursor-not-allowed disabled:transform-none"
          disabled={!detail.selectedPaper || detail.isSavingDiscussion}
          onClick={async () => {
            try {
              await saveDiscussion();
            } catch (error) {
              window.alert(error instanceof Error ? error.message : "讨论发布失败，请稍后重试。");
            }
          }}
        >
          发布讨论
        </button>
        <button
          id="cancel-discussion-button"
          className="flex-none px-4 min-h-[48px] border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/70 text-text transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          type="button"
          disabled={!detail.discussionComposer.draft && !detail.discussionComposer.attachments.length}
          onClick={() => {
            setDetailComposerDraft("discussion", "");
            clearDetailComposerAttachments("discussion");
          }}
        >
          清空输入
        </button>
      </div>
    </section>
  );
});
