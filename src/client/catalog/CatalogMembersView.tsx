import {
  useClientState,
} from "../shared/client-store";
import {
  formatDateTime,
  openAnnotationLocation,
  openDiscussionLocation,
  openPaperDetail,
} from "../shared/session-store";
import { selectMember, setMemberProfilePanel } from "./catalog-store";
import { getSpeechDisplayText, truncate } from "./catalog-helpers";
import type { ClientState, Paper, SpeechActivityRecord } from "../shared/types";

interface CatalogMembersViewProps {
  hidden?: boolean;
}

export function CatalogMembersView({ hidden = false }: CatalogMembersViewProps) {
  const snapshot = useClientState() as ClientState;
  const memberProfilePanel = snapshot.catalog.memberProfilePanel || "papers";
  const selectedMemberProfile = snapshot.members.selectedMemberProfile;
  const uploadedPapers = selectedMemberProfile?.uploadedPapers || [];
  const annotations = selectedMemberProfile?.annotations || [];

  return (
    <section id="members-view" className={`grid lg:grid-cols-[clamp(280px,30vw,360px)_minmax(0,1fr)] grid-cols-1 gap-6 items-start min-h-0${hidden ? " hidden" : ""}`}>
      <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom lg:col-span-1">
        <div className="flex justify-between items-center flex-wrap gap-3 mb-3">
          <h3 className="m-0 text-lg font-bold">课题组成员</h3>
          <span id="member-count" className="text-muted text-[13px]">
            {snapshot.members.groupMembers.length} 人
          </span>
        </div>
        <p className="m-0 mb-3 text-muted leading-relaxed text-sm">这里展示除你之外的其他成员，点击任意成员即可查看其上传的文章和发言。</p>
        <MemberList snapshot={snapshot} />
      </section>

      <section className="p-4.5 border border-paper-border rounded-3xl bg-panel backdrop-blur-md shadow-custom lg:col-span-1">
        <div className="flex justify-start items-center flex-wrap gap-3 mb-3">
          <div className="flex flex-wrap gap-2.5 w-full" role="tablist" aria-label="成员内容分类">
            <button
              id="member-profile-papers-button"
              className={`inline-flex items-center gap-2 min-h-[42px] px-3.5 border border-[rgba(121,92,55,0.18)] rounded-full transition-all flex-1 lg:flex-none justify-between lg:justify-center ${
                memberProfilePanel === "papers" ? "border-accent/30 bg-accent text-white shadow-md" : "bg-white/72 text-muted hover:bg-accent/5"
              }`}
              type="button"
              role="tab"
              aria-selected={memberProfilePanel === "papers"}
              onClick={() => setMemberProfilePanel("papers")}
            >
              TA 上传的文章
              <span id="member-profile-paper-count" className={`text-[12px] ${memberProfilePanel === "papers" ? "text-white/84" : "text-muted"}`}>
                {uploadedPapers.length} 篇
              </span>
            </button>
            <button
              id="member-profile-speeches-button"
              className={`inline-flex items-center gap-2 min-h-[42px] px-3.5 border border-[rgba(121,92,55,0.18)] rounded-full transition-all flex-1 lg:flex-none justify-between lg:justify-center ${
                memberProfilePanel === "speeches" ? "border-accent/30 bg-accent text-white shadow-md" : "bg-white/72 text-muted hover:bg-accent/5"
              }`}
              type="button"
              role="tab"
              aria-selected={memberProfilePanel === "speeches"}
              onClick={() => setMemberProfilePanel("speeches")}
            >
              TA 的发言
              <span id="member-profile-annotation-count" className={`text-[12px] ${memberProfilePanel === "speeches" ? "text-white/84" : "text-muted"}`}>
                {annotations.length} 条
              </span>
            </button>
          </div>
        </div>

        <section
          id="member-profile-papers"
          className={`mt-1${memberProfilePanel === "papers" ? "" : " hidden"}`}
          role="tabpanel"
          aria-labelledby="member-profile-papers-button"
        >
          <p className="m-0 mb-3 text-muted leading-relaxed text-sm">按文章上传时间排序，点击“详情”可跳转到对应文章。</p>
          <MemberPaperList papers={uploadedPapers} snapshot={snapshot} />
        </section>

        <section
          id="member-profile-speeches"
          className={`mt-1${memberProfilePanel === "speeches" ? "" : " hidden"}`}
          role="tabpanel"
          aria-labelledby="member-profile-speeches-button"
        >
          <p className="m-0 mb-3 text-muted leading-relaxed text-sm">按最新发言时间排序，点击“详情”可跳转到对应文章和发言。</p>
          <MemberSpeechList annotations={annotations} snapshot={snapshot} />
        </section>
      </section>
    </section>
  );
}

function MemberList({ snapshot }: { snapshot: ClientState }) {
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

function MemberPaperList({ papers, snapshot }: { papers: Paper[]; snapshot: ClientState }) {
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

function MemberSpeechList({
  annotations,
  snapshot,
}: {
  annotations: SpeechActivityRecord[];
  snapshot: ClientState;
}) {
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
