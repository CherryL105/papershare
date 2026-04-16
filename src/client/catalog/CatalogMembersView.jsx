import {
  useClientState,
} from "../shared/client-store.js";
import {
  formatDateTime,
  openAnnotationLocation,
  openDiscussionLocation,
  openPaperDetail,
} from "../shared/session-store.js";
import { selectMember, setMemberProfilePanel } from "./catalog-store.js";
import { getSpeechDisplayText, truncate } from "./catalog-helpers.js";

export function CatalogMembersView({ hidden = false }) {
  const snapshot = useClientState();
  const memberProfilePanel = snapshot.catalog.memberProfilePanel || "papers";
  const selectedMemberProfile = snapshot.members.selectedMemberProfile;
  const uploadedPapers = selectedMemberProfile?.uploadedPapers || [];
  const annotations = selectedMemberProfile?.annotations || [];

  return (
    <section id="members-view" className={`profile-grid${hidden ? " is-hidden" : ""}`}>
      <section className="panel">
        <div className="panel-header">
          <h3>课题组成员</h3>
          <span id="member-count" className="status-pill">
            {snapshot.members.groupMembers.length} 人
          </span>
        </div>
        <p className="panel-tip">这里展示除你之外的其他成员，点击任意成员即可查看其上传的文章和发言。</p>
        <MemberList snapshot={snapshot} />
      </section>

      <section className="panel profile-annotations-panel">
        <div className="panel-header">
          <div className="profile-panel-tabs" role="tablist" aria-label="成员内容分类">
            <button
              id="member-profile-papers-button"
              className={`profile-panel-tab${memberProfilePanel === "papers" ? " active" : ""}`}
              type="button"
              role="tab"
              aria-selected={memberProfilePanel === "papers"}
              onClick={() => setMemberProfilePanel("papers")}
            >
              TA 上传的文章
              <span id="member-profile-paper-count" className="annotation-count">
                {uploadedPapers.length} 篇
              </span>
            </button>
            <button
              id="member-profile-speeches-button"
              className={`profile-panel-tab${memberProfilePanel === "speeches" ? " active" : ""}`}
              type="button"
              role="tab"
              aria-selected={memberProfilePanel === "speeches"}
              onClick={() => setMemberProfilePanel("speeches")}
            >
              TA 的发言
              <span id="member-profile-annotation-count" className="annotation-count">
                {annotations.length} 条
              </span>
            </button>
          </div>
        </div>

        <section
          id="member-profile-papers"
          className={`profile-panel-view${memberProfilePanel === "papers" ? "" : " is-hidden"}`}
          role="tabpanel"
          aria-labelledby="member-profile-papers-button"
        >
          <p className="panel-tip">按文章上传时间排序，点击“详情”可跳转到对应文章。</p>
          <MemberPaperList papers={uploadedPapers} snapshot={snapshot} />
        </section>

        <section
          id="member-profile-speeches"
          className={`profile-panel-view${memberProfilePanel === "speeches" ? "" : " is-hidden"}`}
          role="tabpanel"
          aria-labelledby="member-profile-speeches-button"
        >
          <p className="panel-tip">按最新发言时间排序，点击“详情”可跳转到对应文章和发言。</p>
          <MemberSpeechList annotations={annotations} snapshot={snapshot} />
        </section>
      </section>
    </section>
  );
}

function MemberList({ snapshot }) {
  if (!snapshot.auth.currentUser) {
    return (
      <div id="member-list" className="paper-list empty-state">
        登录后可查看组员动向。
      </div>
    );
  }

  if (!snapshot.members.groupMembers.length) {
    return (
      <div id="member-list" className="paper-list empty-state">
        当前还没有其他成员。
      </div>
    );
  }

  return (
    <div id="member-list" className="paper-list">
      {snapshot.members.groupMembers.map((member) => {
        const isActive = member.id === snapshot.members.selectedMemberId;

        return (
          <button
            key={member.id}
            className={`paper-item${isActive ? " active" : ""}`}
            type="button"
            onClick={() => void selectMember(member.id)}
          >
            <strong>{member.username}</strong>
            <span>用户名：{member.username}</span>
            <span>
              累计上传 {member.uploadedPaperCount || 0} 篇 · 累计发言 {member.annotationCount || 0} 条
            </span>
            <span>加入时间：{formatDateTime(member.createdAt)}</span>
          </button>
        );
      })}
    </div>
  );
}

function MemberPaperList({ papers, snapshot }) {
  if (!snapshot.auth.currentUser) {
    return (
      <div id="member-profile-paper-list" className="annotation-list empty-state">
        登录后可查看其他成员上传的文章。
      </div>
    );
  }

  if (!snapshot.members.selectedMemberId) {
    return (
      <div id="member-profile-paper-list" className="annotation-list empty-state">
        请选择一位成员。
      </div>
    );
  }

  if (!snapshot.members.selectedMemberProfile) {
    return (
      <div id="member-profile-paper-list" className="annotation-list empty-state">
        正在加载文章列表...
      </div>
    );
  }

  if (!papers.length) {
    return (
      <div id="member-profile-paper-list" className="annotation-list empty-state">
        这位成员还没有上传文章。
      </div>
    );
  }

  return (
    <div id="member-profile-paper-list" className="annotation-list">
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
            <button className="ghost-button" type="button" onClick={() => openPaperDetail(paper.id)}>
              详情
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function MemberSpeechList({ annotations, snapshot }) {
  if (!snapshot.auth.currentUser) {
    return (
      <div id="member-profile-annotation-list" className="annotation-list empty-state">
        登录后可查看其他成员发言。
      </div>
    );
  }

  if (!snapshot.members.selectedMemberId) {
    return (
      <div id="member-profile-annotation-list" className="annotation-list empty-state">
        请选择一位成员。
      </div>
    );
  }

  if (!snapshot.members.selectedMemberProfile) {
    return (
      <div id="member-profile-annotation-list" className="annotation-list empty-state">
        正在加载发言列表...
      </div>
    );
  }

  if (!annotations.length) {
    return (
      <div id="member-profile-annotation-list" className="annotation-list empty-state">
        这位成员还没有创建发言。
      </div>
    );
  }

  return (
    <div id="member-profile-annotation-list" className="annotation-list">
      {annotations.map((annotation) => {
        const isActive = isSpeechRecordActive(snapshot, annotation);

        return (
          <article key={annotation.id} className={`annotation-item${isActive ? " active" : ""}`}>
            <div className="annotation-item-body">
              <strong className="annotation-item-text">{getSpeechDisplayText(annotation)}</strong>
              <span className="annotation-target">
                {annotation.paperExists === false
                  ? "文献已删除"
                  : truncate(annotation.paperTitle || "未命名文献", 100)}
              </span>
              <AttachmentSummaryTag record={annotation} />
            </div>
            <div className="annotation-item-actions">
              <button className="ghost-button" type="button" onClick={() => void openSpeechDetail(annotation)}>
                详情
              </button>
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
