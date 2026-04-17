import { memo } from "preact/compat";
import type { ClientState } from "../../shared/types";
import { getAnnotationScopeLabel } from "../../shared/speech-helpers";
import {
  setDetailComposerDraft,
  addDetailComposerAttachments,
  removeDetailComposerAttachment,
  clearDetailComposerAttachments,
  saveAnnotation,
  clearPendingSelection,
} from "../detail-store";
import { AttachmentComposer } from "./AttachmentComponents";

export const AnnotationComposer = memo(({ snapshot }: { snapshot: ClientState }) => {
  const detail = snapshot.detail;
  const hasSelection = Boolean(detail.pendingSelection);
  const disabled =
    !snapshot.auth.currentUser ||
    !snapshot.auth.serverReady ||
    !detail.selectedPaper ||
    !hasSelection ||
    detail.isSavingAnnotation;
  const selectionStatus = !snapshot.auth.currentUser
    ? "登录后可批注"
    : !detail.selectedPaper
      ? "请选择文献"
      : hasSelection
        ? `${getAnnotationScopeLabel(detail.pendingSelection?.target_scope)}已选中文本`
        : "未选择文本";

  return (
    <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
      <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
        <h3 className="m-0 text-lg font-bold">新建批注</h3>
        <span id="selection-status" className="text-muted text-[13px]">
          {selectionStatus}
        </span>
      </div>
      <p className="m-0 mb-3 text-muted leading-relaxed text-sm">
        可在标题、作者、摘要或正文中选中一段文字，再填写批注并保存。批注会按当前文献 ID 关联保存。
      </p>
      <textarea
        id="annotation-input"
        className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none resize-y min-h-[80px]"
        rows={2}
        placeholder="例如：这里的实验设计可以和我们组的样地数据对照。"
        value={detail.annotationComposer.draft}
        onInput={(event) => setDetailComposerDraft("annotation", event.currentTarget.value)}
        disabled={!snapshot.auth.currentUser || !detail.selectedPaper}
      ></textarea>
      <AttachmentComposer
        idPrefix="annotation"
        files={detail.annotationComposer.attachments}
        disabled={!snapshot.auth.currentUser || !detail.selectedPaper}
        onAddFiles={(files) => addDetailComposerAttachments("annotation", files)}
        onRemoveFile={(index) => removeDetailComposerAttachment("annotation", index)}
        onClear={() => clearDetailComposerAttachments("annotation")}
      />
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch mt-3">
        <button
          id="add-annotation-button"
          className="flex-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c] disabled:cursor-not-allowed disabled:transform-none"
          disabled={disabled}
          onClick={async () => {
            try {
              await saveAnnotation();
            } catch (error) {
              window.alert(error instanceof Error ? error.message : "批注保存失败，请稍后重试。");
            }
          }}
        >
          添加批注
        </button>
        <button
          id="cancel-annotation-button"
          className="flex-none px-4 min-h-[48px] border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/70 text-text transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          type="button"
          disabled={!hasSelection && !detail.annotationComposer.draft && !detail.annotationComposer.attachments.length}
          onClick={() => {
            clearPendingSelection();
            setDetailComposerDraft("annotation", "");
            clearDetailComposerAttachments("annotation");
          }}
        >
          取消批注
        </button>
      </div>
    </section>
  );
});
