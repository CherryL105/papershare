import type { Annotation, Discussion, EditState } from "../../shared/types";
import type { ComponentChildren, JSX } from "preact";
import { formatDateTime } from "../../shared/session-store";
import { getRecordNoteDisplay } from "../../shared/speech-helpers";
import {
  setDetailEditDraft,
  addDetailEditAttachments,
  removeDetailEditAttachment,
  clearDetailEditAttachments,
} from "../detail-store";
import { AttachmentEditor, PersistedAttachmentList } from "./AttachmentComponents";

type DisplayRecord = Annotation | Discussion;

export function RecordDisplay({
  compact = false,
  record,
  relationText = "",
}: {
  compact?: boolean;
  record: DisplayRecord;
  relationText?: string;
}) {
  return (
    <div className={`mt-3 p-3.5 rounded-2xl bg-white/72 border border-[rgba(121,92,55,0.12)] overflow-auto min-h-[180px] ${compact ? "min-h-0" : ""}`}>
      {relationText ? <h4 className="m-0 mb-3 text-lg font-bold">{relationText}</h4> : null}
      <div className="flex flex-wrap justify-between items-start gap-3 mb-3">
        <strong className="m-0 flex-1 min-w-[220px] break-words">{record?.created_by_username || "未知用户"}</strong>
        <time className="text-muted text-[12px] whitespace-nowrap">{formatDateTime(record?.created_at)}</time>
      </div>
      <p className="m-0 mb-3 leading-[1.7]" style={{ whiteSpace: "pre-wrap" }}>{getRecordNoteDisplay(record)}</p>
      <PersistedAttachmentList attachments={record?.attachments} />
    </div>
  );
}

export function ThreadReplyCard({
  active = false,
  children,
  dataAttributeName,
  dataAttributeValue,
  onDelete,
  onEdit,
  onSelect,
}: {
  active?: boolean;
  children: ComponentChildren;
  dataAttributeName?: string;
  dataAttributeValue?: string;
  onDelete?: () => void;
  onEdit?: () => void;
  onSelect?: () => void;
}) {
  return (
    <div
      className={`grid gap-2.5 p-3.5 rounded-2xl border border-[rgba(121,92,55,0.12)] bg-white/72 transition-all cursor-pointer hover:border-accent/20 ${active ? "border-accent/36 bg-accent-soft active" : ""}`}
      {...(dataAttributeName ? { [dataAttributeName]: dataAttributeValue } : {})}
      onClick={onSelect}
    >
      {children}
      {onEdit || onDelete ? (
        <div className="flex flex-wrap gap-2 justify-start mt-2">
          {onEdit ? (
            <button
              className="inline-flex items-center justify-center min-h-[36px] px-3 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text text-sm transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
            >
              编辑
            </button>
          ) : null}
          {onDelete ? (
            <button
              className="inline-flex items-center justify-center min-h-[36px] px-3 border border-[rgba(139,30,45,0.18)] rounded-full text-[#8b1e2d] bg-white/60 text-sm transition-all hover:bg-[rgba(139,30,45,0.08)] active:scale-95"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
            >
              删除
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SpeechInlineEditor({
  editState,
  kind,
  onCancel,
  onSave,
  saveButtonLabel,
}: {
  editState: EditState;
  kind: "discussion" | "annotation";
  onCancel: () => void;
  onSave: () => Promise<Annotation | Discussion | null>;
  saveButtonLabel: string;
}) {
  return (
    <div className="grid gap-3">
      <label className="text-muted text-[13px] font-bold" htmlFor={`${kind}-detail-editor`}>
        编辑内容
      </label>
      <textarea
        id={`${kind}-detail-editor`}
        className="w-full min-w-0 px-3.5 py-3 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none min-h-[132px] resize-y"
        value={editState.draft}
        onInput={(event: JSX.TargetedEvent<HTMLTextAreaElement, Event>) =>
          setDetailEditDraft(kind, event.currentTarget.value)
        }
      ></textarea>
      <AttachmentEditor
        kind={kind}
        items={editState.attachments}
        disabled={editState.isSaving}
        onAddFiles={(files) => addDetailEditAttachments(kind, files)}
        onRemoveItem={(key) => removeDetailEditAttachment(kind, key)}
        onClear={() => clearDetailEditAttachments(kind)}
      />
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch mt-1">
        <button
          className="flex-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c]"
          type="button"
          disabled={editState.isSaving}
          onClick={async () => {
            try {
              await onSave();
            } catch (error) {
              window.alert(error instanceof Error ? error.message : "保存失败，请稍后再试。");
            }
          }}
        >
          {saveButtonLabel}
        </button>
        <button className="flex-none px-4 min-h-[48px] border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/70 text-text transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50" type="button" disabled={editState.isSaving} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
