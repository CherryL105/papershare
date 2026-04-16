import {
  deleteActivity,
  deletePaperById,
  setCatalogView,
  setProfilePanel,
} from "./catalog-store.js";
import { useClientState } from "../shared/client-store.js";
import {
  formatDateTime,
  openAnnotationLocation,
  openDiscussionLocation,
  openPaperDetail,
} from "../shared/session-store.js";
import {
  formatUserBadge,
  getSpeechDeleteLabel,
  getSpeechDisplayText,
  isCurrentUserAdmin,
  truncate,
} from "./catalog-helpers.js";

export function CatalogProfileView({ hidden = false }) {
  const snapshot = useClientState();
  const currentUser = snapshot.auth.currentUser;
  const isAdmin = isCurrentUserAdmin(currentUser);
  const profilePanel = snapshot.catalog.profilePanel || "papers";
  const uploadedPapers = snapshot.profile.uploadedPapers || [];
  const myAnnotations = snapshot.profile.myAnnotations || [];
  const receivedReplies = snapshot.profile.repliesToMyAnnotations || [];

  return (
    <section id="profile-view" className={`profile-grid${hidden ? " is-hidden" : ""}`}>
      <section className="panel profile-overview">
        <div className="panel-header">
          <h3>个人信息</h3>
          <span id="profile-stats" className="status-pill">
            {`${uploadedPapers.length} 篇上传 / ${myAnnotations.length} 条发言`}
          </span>
        </div>

        {!currentUser ? (
          <div id="profile-summary" className="profile-summary empty-state">
            登录后可查看你的账号信息。
          </div>
        ) : (
          <div id="profile-summary" className="profile-summary">
            <p className="profile-username">
              用户名：<code>{currentUser.username}</code>
            </p>
            <p>账号角色：{isAdmin ? "管理员" : "普通成员"}</p>
            <p>账号创建时间：{formatDateTime(currentUser.createdAt)}</p>
          </div>
        )}

        <div className="profile-action-stack">
          <p className="panel-tip">在账号设置里可以修改你的用户名和登录密码。</p>
          <div className="profile-action-row">
            <button
              id="account-settings-button"
              className="primary-button"
              type="button"
              disabled={!currentUser}
              onClick={() => void setCatalogView("password")}
            >
              账号设置
            </button>
            <button
              id="user-management-button"
              className={`ghost-button${isAdmin ? "" : " is-hidden"}`}
              type="button"
              disabled={!currentUser}
              onClick={() => void setCatalogView("user-management")}
            >
              用户管理
            </button>
          </div>
        </div>
      </section>

      <section className="panel profile-annotations-panel">
        <div className="panel-header">
          <div id="profile-panel-tabs" className="profile-panel-tabs" role="tablist" aria-label="我的内容分类">
            <button
              id="profile-panel-papers-button"
              className={`profile-panel-tab${profilePanel === "papers" ? " active" : ""}`}
              type="button"
              role="tab"
              aria-selected={profilePanel === "papers"}
              onClick={() => setProfilePanel("papers")}
            >
              我上传的文章
              <span id="my-paper-count" className="annotation-count">
                {uploadedPapers.length} 篇
              </span>
            </button>
            <button
              id="profile-panel-speeches-button"
              className={`profile-panel-tab${profilePanel === "speeches" ? " active" : ""}`}
              type="button"
              role="tab"
              aria-selected={profilePanel === "speeches"}
              onClick={() => setProfilePanel("speeches")}
            >
              我的发言
              <span id="my-annotation-count" className="annotation-count">
                {myAnnotations.length} 条
              </span>
            </button>
            <button
              id="profile-panel-replies-button"
              className={`profile-panel-tab${profilePanel === "replies" ? " active" : ""}`}
              type="button"
              role="tab"
              aria-selected={profilePanel === "replies"}
              onClick={() => setProfilePanel("replies")}
            >
              别人回复我
              <span id="received-reply-count" className="annotation-count">
                {receivedReplies.length} 条
              </span>
            </button>
          </div>
        </div>

        <section
          id="profile-panel-papers"
          className={`profile-panel-view${profilePanel === "papers" ? "" : " is-hidden"}`}
          role="tabpanel"
          aria-labelledby="profile-panel-papers-button"
        >
          <p className="panel-tip">按文章上传时间排序，点击“详情”可跳转到对应文章及批注。</p>
          <ProfilePaperList snapshot={snapshot} papers={uploadedPapers} />
        </section>

        <section
          id="profile-panel-speeches"
          className={`profile-panel-view${profilePanel === "speeches" ? "" : " is-hidden"}`}
          role="tabpanel"
          aria-labelledby="profile-panel-speeches-button"
        >
          <p className="panel-tip">按最新发言时间排序，点击“详情”可跳转到对应文章和发言。</p>
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
          className={`profile-panel-view${profilePanel === "replies" ? "" : " is-hidden"}`}
          role="tabpanel"
          aria-labelledby="profile-panel-replies-button"
        >
          <p className="panel-tip">按最新回复时间排序，点击“详情”可跳转到对应文章和这条回复。</p>
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

function ProfilePaperList({ papers, snapshot }) {
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

function ProfileSpeechList({ emptyText, listId, records, snapshot, showDelete = false }) {
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

function AttachmentSummaryTag({ record }) {
  const attachmentCount = Array.isArray(record?.attachments) ? record.attachments.length : 0;

  if (!attachmentCount) {
    return null;
  }

  return <span className="attachment-summary-tag">附件 {attachmentCount} 个</span>;
}

function isSpeechRecordActive(snapshot, record) {
  const speechType = record?.speech_type === "discussion" ? "discussion" : "annotation";
  const threadId =
    record?.thread_id || record?.thread_annotation_id || record?.thread_discussion_id || record?.id;

  if (speechType === "discussion") {
    return (
      threadId === snapshot.detail.selectedDiscussionId &&
      (!record?.is_reply || record.id === snapshot.detail.selectedDiscussionReplyId)
    );
  }

  return (
    threadId === snapshot.detail.selectedAnnotationId &&
    (!record?.is_reply || record.id === snapshot.detail.selectedReplyId)
  );
}

async function openSpeechDetail(record) {
  const threadId =
    record?.thread_id || record?.thread_annotation_id || record?.thread_discussion_id || record?.id;

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

function openPaperDetailFromProfile(paperId) {
  if (!paperId) {
    return;
  }

  openPaperDetail(paperId);
}

async function handleDeletePaper(paper) {
  const confirmed = window.confirm(
    `确定删除文献“${truncate(paper.title || "未命名文献", 60)}”吗？该文献下的全部批注也会一起删除。`
  );

  if (!confirmed) {
    return;
  }

  try {
    await deletePaperById(paper.id);
  } catch (error) {
    window.alert(error.message || "删除文献失败，请稍后再试。");
  }
}

async function handleDeleteSpeech(record) {
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
    window.alert(error.message || "删除发言失败，请稍后再试。");
  }
}
