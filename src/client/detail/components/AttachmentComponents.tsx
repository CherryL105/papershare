import { ATTACHMENT_INPUT_ACCEPT, buildAttachmentUrl, getAttachmentCategory, getAttachmentCategoryLabel, formatFileSize } from "../../shared/speech-helpers";
import type { Attachment, EditableAttachmentItem } from "../../shared/types";
import { buildApiUrl } from "../../shared/session-store";
import type { JSX } from "preact";

export function AttachmentComposer({
  disabled = false,
  files,
  idPrefix,
  onAddFiles,
  onClear,
  onRemoveFile,
}: {
  disabled?: boolean;
  files: (File | EditableAttachmentItem)[];
  idPrefix: string;
  onAddFiles: (files: File[]) => void;
  onClear: () => void;
  onRemoveFile: (index: number) => void;
}) {
  return (
    <div className="grid gap-2.5">
      <label className="grid gap-2">
        <span className="text-[13px] text-muted">附件（支持图片与表格，可多选）</span>
        <input
          id={`${idPrefix}-attachments`}
          className="w-full min-w-0 px-3 py-2.5 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
          type="file"
          accept={ATTACHMENT_INPUT_ACCEPT}
          multiple
          disabled={disabled}
          onChange={(event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
            const nextFiles = Array.from(event.currentTarget.files || []) as File[];

            if (!nextFiles.length) {
              return;
            }

            try {
              onAddFiles(nextFiles);
            } catch (error) {
              window.alert(error instanceof Error ? error.message : "附件不符合上传要求。");
            } finally {
              event.currentTarget.value = "";
            }
          }}
        />
      </label>
      <div className="flex items-center justify-between gap-2.5 flex-wrap">
        <p className="m-0 mb-0 text-muted leading-relaxed text-[13px]">
          支持 PNG、JPG、GIF、WEBP、BMP、CSV、TSV、XLS、XLSX、ODS。
        </p>
        <button id={`clear-${idPrefix}-attachments-button`} className="inline-flex items-center justify-center min-h-[40px] px-3.5 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text text-sm transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50" type="button" onClick={onClear}>
          清空附件
        </button>
      </div>
      <ComposerAttachmentPreview id={`${idPrefix}-attachments-preview`} files={files} onRemove={onRemoveFile} />
    </div>
  );
}

export function ComposerAttachmentPreview({
  files,
  id,
  onRemove,
}: {
  files: (File | EditableAttachmentItem)[];
  id: string;
  onRemove: (index: number) => void;
}) {
  if (!files?.length) {
    return (
      <div id={id} className="p-3 border-2 border-dashed border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/42 text-muted text-center text-sm">
        还没有选择附件。
      </div>
    );
  }

  return (
      <div id={id} className="p-3 border-2 border-dashed border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/42 grid gap-2.5">
      {files.map((fileOrItem, index) => {
        const file = fileOrItem instanceof File ? fileOrItem : fileOrItem.file;
        const attachment = fileOrItem instanceof File ? null : fileOrItem.attachment;
        const name = file ? file.name : attachment?.original_name || "未命名";
        const size = file ? file.size : attachment?.size_bytes || 0;

        return (
          <div key={`${name}-${size}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 p-2.5 px-3 rounded-2xl bg-white/78 border border-[rgba(121,92,55,0.12)]">
            <div className="min-w-0">
              <strong className="block truncate text-sm">{name}</strong>
              <span className="block text-muted text-[13px]">
                {getAttachmentCategoryLabel(file || attachment)} · {formatFileSize(size)}
              </span>
            </div>
            <button
              className="inline-flex items-center justify-center min-h-[36px] px-3.5 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text text-sm transition-all hover:bg-white hover:text-red-600 active:scale-95"
              type="button"
              onClick={() => onRemove(index)}
            >
              删除
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function AttachmentEditor({
  disabled = false,
  items,
  kind,
  onAddFiles,
  onClear,
  onRemoveItem,
}: {
  disabled?: boolean;
  items: EditableAttachmentItem[];
  kind: "discussion" | "annotation";
  onAddFiles: (files: File[]) => void;
  onClear: () => void;
  onRemoveItem: (key: string) => void;
}) {
  const inputId = `${kind}-detail-attachments`;

  return (
    <div className="grid gap-2.5">
      <label className="grid gap-2">
        <span className="text-[13px] text-muted">附件</span>
        <input
          id={inputId}
          className="w-full min-w-0 px-3 py-2.5 border border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/92 text-text transition-all focus:ring-2 focus:ring-accent/20 focus:border-accent outline-none"
          type="file"
          accept={ATTACHMENT_INPUT_ACCEPT}
          multiple
          disabled={disabled}
          onChange={(event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
            const nextFiles = Array.from(event.currentTarget.files || []) as File[];

            if (!nextFiles.length) {
              return;
            }

            try {
              onAddFiles(nextFiles);
            } catch (error) {
              window.alert(error instanceof Error ? error.message : "附件不符合上传要求。");
            } finally {
              event.currentTarget.value = "";
            }
          }}
        />
      </label>
      <div className="flex items-center justify-between gap-2.5 flex-wrap">
        <p className="m-0 mb-0 text-muted leading-relaxed text-[13px]">可保留已有附件，也可继续追加新的附件。</p>
        <button className="inline-flex items-center justify-center min-h-[40px] px-3.5 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text text-sm transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95" type="button" onClick={onClear}>
          清空附件
        </button>
      </div>
      {!items?.length ? (
        <div className="p-3 border-2 border-dashed border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/42 text-muted text-center text-sm">还没有选择附件。</div>
      ) : (
        <div className="p-3 border-2 border-dashed border-[rgba(121,92,55,0.2)] rounded-2xl bg-white/42 grid gap-2.5">
          {items.map((item) => (
            <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 p-2.5 px-3 rounded-2xl bg-white/78 border border-[rgba(121,92,55,0.12)]">
              <div className="min-w-0">
                <strong className="block truncate text-sm">
                  {item.kind === "existing"
                    ? item.attachment?.original_name || item.attachment?.filename || "未命名附件"
                    : item.file?.name || "未命名附件"}
                </strong>
                <span className="block text-muted text-[13px]">
                  {item.kind === "existing"
                    ? `${getAttachmentCategoryLabel(item.attachment)} · ${formatFileSize(
                        item.attachment?.size_bytes || 0
                      )}`
                    : `${getAttachmentCategoryLabel(item.file)} · ${formatFileSize(item.file?.size || 0)}`}
                </span>
              </div>
              <button className="inline-flex items-center justify-center min-h-[36px] px-3.5 border border-[rgba(121,92,55,0.2)] rounded-full bg-white/70 text-text text-sm transition-all hover:bg-white hover:text-red-600 active:scale-95" type="button" onClick={() => onRemoveItem(item.key)}>
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PersistedAttachmentList({ attachments }: { attachments: Attachment[] | undefined }) {
  if (!attachments?.length) {
    return null;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5 mb-3">
      {attachments.map((attachment) => {
        const attachmentUrl = buildAttachmentUrl(attachment, buildApiUrl);
        const attachmentName =
          attachment?.original_name || attachment?.filename || "未命名附件";
        const attachmentMeta = `${getAttachmentCategoryLabel(attachment)} · ${formatFileSize(
          attachment?.size_bytes || 0
        )}`;
        const isImage = getAttachmentCategory(attachment) === "image";

        return (
          <a
            key={attachment.id || attachment.storage_path || attachment.url || attachmentName}
            className={`grid gap-2 items-start min-h-[92px] p-3 rounded-2xl border border-[rgba(121,92,55,0.12)] bg-white/76 text-inherit no-underline transition-all hover:border-accent/26 hover:bg-white/92 hover:shadow-sm active:scale-[0.98] ${isImage ? "p-0 overflow-hidden" : ""}`}
            href={attachmentUrl}
            target="_blank"
            rel="noreferrer"
            download={isImage ? undefined : true}
          >
            {isImage ? (
              <>
                <img className="block w-full aspect-[4/3] object-cover bg-accent/6" src={attachmentUrl} alt={attachmentName} loading="lazy" />
                <span className="block truncate text-sm px-3">{attachmentName}</span>
                <span className="block text-muted text-[13px] px-3 pb-3">{attachmentMeta}</span>
              </>
            ) : (
              <>
                <strong className="block truncate text-sm">{attachmentName}</strong>
                <span className="block text-muted text-[13px] leading-snug">{attachmentMeta}</span>
              </>
            )}
          </a>
        );
      })}
    </div>
  );
}
