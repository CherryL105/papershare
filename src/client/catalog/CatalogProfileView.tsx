import {
  deleteActivity,
  deletePaperById,
  setCatalogView,
  setProfilePanel,
} from "./catalog-store";
import { useClientState } from "../shared/client-store";
import {
  formatDateTime,
  openAnnotationLocation,
  openDiscussionLocation,
  openPaperDetail,
} from "../shared/session-store";
import {
  formatUserBadge,
  getSpeechDeleteLabel,
  getSpeechDisplayText,
  isCurrentUserAdmin,
  truncate,
} from "./catalog-helpers";
import type { ClientState, DeleteActivityRecord, Paper, SpeechActivityRecord } from "../shared/types";

interface CatalogProfileViewProps {
  hidden?: boolean;
}

export function CatalogProfileView({ hidden = false }: CatalogProfileViewProps) {
  const snapshot = useClientState() as ClientState;
  const currentUser = snapshot.auth.currentUser;
  const isAdmin = isCurrentUserAdmin(currentUser);
  const profilePanel = snapshot.catalog.profilePanel || "papers";
  const uploadedPapers = snapshot.profile.uploadedPapers || [];
  const myAnnotations = snapshot.profile.myAnnotations || [];
  const receivedReplies = snapshot.profile.repliesToMyAnnotations || [];

  return (
    <section id="profile-view" className={`grid grid-cols-1 gap-6 items-start min-h-0${hidden ? " hidden" : ""}`}>
      <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
        <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
          <h3 className="m-0 text-lg font-bold">个人信息</h3>
          <span id="profile-stats" className="text-muted text-[13px]">
            {`${uploadedPapers.length} 篇上传 / ${myAnnotations.length} 条发言`}
          </span>
        </div>

        {!currentUser ? (
          <div id="profile-summary" className="text-muted leading-relaxed">
            登录后可查看你的账号信息。
          </div>
        ) : (
          <div id="profile-summary" className="grid gap-4">
            <p className="m-0 text-[22px] font-bold leading-tight">
              用户名：<code className="bg-accent/8 text-accent px-1.5 py-0.5 rounded-md text-[0.95em] font-mono">{currentUser.username}</code>
            </p>
            <p className="m-0 text-muted leading-relaxed">账号角色：{isAdmin ? "管理员" : "普通成员"}</p>
            <p className="m-0 text-muted leading-relaxed">账号创建时间：{formatDateTime(currentUser.createdAt)}</p>
          </div>
        )}

        <div className="grid gap-4 mt-6">
          <p className="m-0 text-muted leading-relaxed text-sm">在账号设置里可以修改你的用户名和登录密码。</p>
          <div className="flex flex-wrap gap-3">
            <button
              id="account-settings-button"
              className="flex-1 min-h-[48px] border-0 rounded-2xl bg-accent text-white font-bold transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95 disabled:bg-[#98a49c]"
              type="button"
              disabled={!currentUser}
              onClick={() => void setCatalogView("password")}
            >
              账号设置
            </button>
            <button
              id="user-management-button"
              className={`flex-1 min-h-[48px] border border-[rgba(121,92,55,0.2)] rounded-full px-4 bg-white/70 text-text transition-all hover:-translate-y-0.5 hover:bg-white active:scale-95 disabled:opacity-50${isAdmin ? "" : " hidden"}`}
              type="button"
              disabled={!currentUser}
              onClick={() => void setCatalogView("user-management")}
            >
              用户管理
            </button>
          </div>
        </div>
      </section>

      <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom">
        <div className="flex justify-start items-center flex-wrap gap-3 mb-3">
          <div id="profile-panel-tabs" className="flex flex-wrap gap-2.5 w-full" role="tablist" aria-label="我的内容分类">
            <button
              id="profile-panel-papers-button"
              className={`inline-flex items-center gap-2 min-h-[42px] px-3.5 border border-[rgba(121,92,55,0.18)] rounded-full transition-all flex-1 lg:flex-none justify-between lg:justify-center ${
                profilePanel === "papers" ? "border-accent/30 bg-accent text-white shadow-md" : "bg-white/72 text-muted hover:bg-accent/5"
              }`}
              type="button"
              role="tab"
              aria-selected={profilePanel === "papers"}
              onClick={() => setProfilePanel("papers")}
            >
              我上传的文章
              <span id="my-paper-count" className={`text-[12px] ${profilePanel === "papers" ? "text-white/84" : "text-muted"}`}>
                {uploadedPapers.length} 篇
              </span>
            </button>
            <button
              id="profile-panel-speeches-button"
              className={`inline-flex items-center gap-2 min-h-[42px] px-3.5 border border-[rgba(121,92,55,0.18)] rounded-full transition-all flex-1 lg:flex-none justify-between lg:justify-center ${
                profilePanel === "speeches" ? "border-accent/30 bg-accent text-white shadow-md" : "bg-white/72 text-muted hover:bg-accent/5"
              }`}
              type="button"
              role="tab"
              aria-selected={profilePanel === "speeches"}
              onClick={() => setProfilePanel("speeches")}
            >
              我的发言
              <span id="my-annotation-count" className={`text-[12px] ${profilePanel === "speeches" ? "text-white/84" : "text-muted"}`}>
                {myAnnotations.length} 条
              </span>
            </button>
            <button
              id="profile-panel-replies-button"
              className={`inline-flex items-center gap-2 min-h-[42px] px-3.5 border border-[rgba(121,92,55,0.18)] rounded-full transition-all flex-1 lg:flex-none justify-between lg:justify-center ${
                profilePanel === "replies" ? "border-accent/30 bg-accent text-white shadow-md" : "bg-white/72 text-muted hover:bg-accent/5"
              }`}
              type="button"
              role="tab"
              aria-selected={profilePanel === "replies"}
              onClick={() => setProfilePanel("replies")}
            >
              别人回复我
              <span id="received-reply-count" className={`text-[12px] ${profilePanel === "replies" ? "text-white/84" : "text-muted"}`}>
                {receivedReplies.length} 条
              </span>
            </button>
          </div>
        </div>

        <section
          id="profile-panel-papers"
          className={`mt-1${profilePanel === "papers" ? "" : " hidden"}`}
          role="tabpanel"
          aria-labelledby="profile-panel-papers-button"
        >
          <p className="m-0 mb-3 text-muted leading-relaxed text-sm">按文章上传时间排序，点击“详情”可跳转到对应文章及批注。</p>
          <ProfilePaperList snapshot={snapshot} papers={uploadedPapers} />
        </section>

        <section
          id="profile-panel-speeches"
          className={`mt-1${profilePanel === "speeches" ? "" : " hidden"}`}
          role="tabpanel"
          aria-labelledby="profile-panel-speeches-button"
        >
          <p className="m-0 mb-3 text-muted leading-relaxed text-sm">按最新发言时间排序，点击“详情”可跳转到对应文章和发言。</p>
          <ProfileSpeechList
            emptyText="你还没有创建自己的发言。"
            listId="my-annotation-list"
            records={myAnnotations}
            snapshot={snapshot}
            showDelete={true}
          />
        </section>

        <section
          id="profile-panel-replies"
          className={`mt-1${profilePanel === "replies" ? "" : " hidden"}`}
          role="tabpanel"
          aria-labelledby="profile-panel-replies-button"
        >
          <p className="m-0 mb-3 text-muted leading-relaxed text-sm">按最新回复时间排序，点击“详情”可跳转到对应文章和这条回复。</p>
          <ProfileSpeechList
            emptyText="目前还没有人回复你。"
            listId="received-reply-list"
            records={receivedReplies}
            snapshot={snapshot}
          />
        </section>
      </section>
    </section>
  );
}

function ProfilePaperList({ papers, snapshot }: { papers: Paper[]; snapshot: ClientState }) {
  if (!snapshot.auth.currentUser) {
    return (
      <div id="my-paper-list" className="annotation-list empty-state">
        登录后可查看你上传的文章。
      </div>
    );
  }

  if (!papers.length) {
    return (
      <div id="my-paper-list" className="annotation-list empty-state">
        你还没有上传自己的文章。
      </div>
    );
  }

  return (
    <div id="my-paper-list" className="annotation-list">
      {papers.map((paper) => (
        <article
          key={paper.id}
          className={`annotation-item${paper.id === snapshot.detail.selectedPaperId ? " active" : ""}`}
        >
          <div className="annotation-item-body">
            <div className="annotation-item-header">
              <strong>{truncate(paper.title || "未命名文献", 96)}</strong>
              <time>{formatDateTime(paper.activity_at || paper.createdAt)}</time>
            </div>
            <span className="annotation-target">{paper.journal || "未填写来源"}</span>
            <span>{truncate(paper.authors || "未填写作者", 120)}</span>
            <span>{paper.published ? `发表时间：${paper.published}` : "发表时间未知"}</span>
          </div>
          <div className="annotation-item-actions">
            <button className="ghost-button" type="button" onClick={() => openPaperDetailFromProfile(paper.id)}>
              详情
            </button>
            <button
              className="ghost-button danger-button"
              type="button"
              onClick={() => void handleDeletePaper(paper)}
            >
              删除文章
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ProfileSpeechList({
  emptyText,
  listId,
  records,
  snapshot,
  showDelete = false,
}: {
  emptyText: string;
  listId: string;
  records: SpeechActivityRecord[];
  snapshot: ClientState;
  showDelete?: boolean;
}) {
  if (!snapshot.auth.currentUser) {
    return (
      <div id={listId} className="annotation-list empty-state">
        登录后可查看相关发言。
      </div>
    );
  }

  if (!records.length) {
    return (
      <div id={listId} className="annotation-list empty-state">
        {emptyText}
      </div>
    );
  }

  return (
    <div id={listId} className="annotation-list">
      {records.map((record) => {
        const isActive = isSpeechRecordActive(snapshot, record);

        return (
          <article key={record.id} className={`annotation-item${isActive ? " active" : ""}`}>
            <div className="annotation-item-body">
              <strong className="annotation-item-text">{getSpeechDisplayText(record)}</strong>
              <span className="annotation-target">
                {record.paperExists === false ? "文献已删除" : truncate(record.paperTitle || "未命名文献", 100)}
              </span>
              <AttachmentSummaryTag record={record} />
            </div>
            <div className="annotation-item-actions">
              <button className="ghost-button" type="button" onClick={() => void openSpeechDetail(record)}>
                详情
              </button>
              {showDelete ? (
                <button
                  className="ghost-button danger-button"
                  type="button"
                  onClick={() => void handleDeleteSpeech(record)}
                >
                  {getSpeechDeleteLabel(record)}
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AttachmentSummaryTag({
  record,
}: {
  record: SpeechActivityRecord | Paper;
}) {
  const attachmentCount = Array.isArray(record?.attachments) ? record.attachments.length : 0;

  if (!attachmentCount) {
    return null;
  }

  return <span className="attachment-summary-tag">附件 {attachmentCount} 个</span>;
}

function isSpeechRecordActive(snapshot: ClientState, record: SpeechActivityRecord) {
  if (record.speech_type === "discussion") {
    const threadId = record.thread_id || record.thread_discussion_id || record.id;

    return (
      threadId === snapshot.detail.selectedDiscussionId &&
      (!record.is_reply || record.id === snapshot.detail.selectedDiscussionReplyId)
    );
  }

  const threadId = record.thread_id || record.thread_annotation_id || record.id;
  return (
    threadId === snapshot.detail.selectedAnnotationId &&
    (!record.is_reply || record.id === snapshot.detail.selectedReplyId)
  );
}

async function openSpeechDetail(record: SpeechActivityRecord) {
  const threadId =
    record.thread_id ||
    (record.speech_type === "discussion"
      ? record.thread_discussion_id
      : record.thread_annotation_id) ||
    record.id;

  if (record?.speech_type === "discussion") {
    await openDiscussionLocation(record.paperId, threadId, {
      focusReplyId: record?.is_reply ? record.id : "",
    });
    return;
  }

  await openAnnotationLocation(record.paperId, threadId, {
    focusReplyId: record?.is_reply ? record.id : "",
  });
}

function openPaperDetailFromProfile(paperId: string) {
  if (!paperId) {
    return;
  }

  openPaperDetail(paperId);
}

async function handleDeletePaper(paper: Paper) {
  const confirmed = window.confirm(
    `确定删除文献“${truncate(paper.title || "未命名文献", 60)}”吗？该文献下的全部批注也会一起删除。`
  );

  if (!confirmed) {
    return;
  }

  try {
    await deletePaperById(paper.id);
  } catch (error) {
    window.alert(getErrorMessage(error, "删除文献失败，请稍后再试。"));
  }
}

async function handleDeleteSpeech(record: DeleteActivityRecord) {
  const label =
    record?.speech_type === "discussion"
      ? record?.is_reply
        ? "回复"
        : "讨论"
      : record?.is_reply
        ? "回复"
        : "发言";
  const confirmed = window.confirm(`确定删除这条${label}吗？`);

  if (!confirmed) {
    return;
  }

  try {
    await deleteActivity(record);
  } catch (error) {
    window.alert(getErrorMessage(error, "删除发言失败，请稍后再试。"));
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
