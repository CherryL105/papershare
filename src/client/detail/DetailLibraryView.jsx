import { useEffect, useRef } from "preact/hooks";
import {
  buildApiUrl,
  clearDetailComposerAttachments,
  clearDetailEditAttachments,
  clearPendingSelection,
  clearSelectedPaperAnnotations,
  deleteAnnotationReply,
  deleteDiscussionReply,
  deleteSelectedAnnotation,
  deleteSelectedDiscussion,
  deleteSelectedPaper,
  handleDetailHashChange,
  initializeDetailPage,
  navigateToLibraryIndex,
  openPaperDetail,
  removeDetailComposerAttachment,
  removeDetailEditAttachment,
  saveAnnotation,
  saveAnnotationReply,
  saveDetailEdit,
  saveDiscussion,
  saveDiscussionReply,
  selectAnnotationReply,
  selectAnnotationThread,
  selectDiscussionReply,
  selectDiscussionThread,
  setDetailComposerDraft,
  setDetailEditDraft,
  setLibraryPanel,
  setPendingSelection,
  startDetailEdit,
  cancelDetailEdit,
  addDetailComposerAttachments,
  addDetailEditAttachments,
  useClientState,
} from "../shared/client-store.js";
import {
  ATTACHMENT_INPUT_ACCEPT,
  buildAttachmentUrl,
  canMutateRecord,
  capturePendingSelection,
  formatFileSize,
  getAnnotationScopeLabel,
  getAttachmentCategory,
  getAttachmentCategoryLabel,
  getDiscussionReplyRelationText,
  getRecordNoteDisplay,
  getRepliesForAnnotation,
  getRepliesForDiscussion,
  getReplyRelationText,
  getTopLevelAnnotations,
  getTopLevelDiscussions,
  installArticleImageFallbacks,
  renderArticleMath,
  restoreAnnotationHighlights,
} from "./detail-helpers.js";
import { formatDateTime } from "../shared/client-store.js";

export function DetailLibraryView() {
  const snapshot = useClientState();
  const detail = snapshot.detail;
  const annotationRootRef = useRef(null);
  const articleRootRef = useRef(null);
  const annotationDetailRef = useRef(null);
  const discussionDetailRef = useRef(null);
  const lastAnnotationNavigationRef = useRef("");
  const lastDiscussionNavigationRef = useRef("");

  useEffect(() => {
    void initializeDetailPage();

    function handleHashChange() {
      void handleDetailHashChange();
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (!annotationRootRef.current) {
      return;
    }

    restoreAnnotationHighlights(annotationRootRef.current, detail.annotations, {
      pendingSelection: detail.pendingSelection,
      activeAnnotationId: detail.selectedAnnotationId,
    });
  }, [
    detail.annotations,
    detail.pendingSelection,
    detail.selectedAnnotationId,
    detail.articleHtml,
    detail.selectedPaperId,
  ]);

  useEffect(() => {
    if (!articleRootRef.current) {
      return;
    }

    renderArticleMath(articleRootRef.current);
    installArticleImageFallbacks(articleRootRef.current, detail.selectedPaper?.sourceUrl || "");
  }, [detail.articleHtml, detail.selectedPaper?.sourceUrl]);

  useEffect(() => {
    if (detail.libraryPanel !== "reader") {
      return;
    }

    const nextNavigationKey = [
      detail.selectedPaperId,
      detail.annotationNavigationTargetId,
      detail.selectedReplyId,
    ].join("::");

    if (!nextNavigationKey || lastAnnotationNavigationRef.current === nextNavigationKey) {
      return;
    }

    const highlight = detail.annotationNavigationTargetId
      ? annotationRootRef.current?.querySelector(
          `[data-annotation-id="${detail.annotationNavigationTargetId}"]`
        )
      : null;
    const listItem = detail.annotationNavigationTargetId
      ? document.querySelector(`[data-annotation-list-id="${detail.annotationNavigationTargetId}"]`)
      : null;
    const replyItem = detail.selectedReplyId
      ? annotationDetailRef.current?.querySelector(`[data-reply-id="${detail.selectedReplyId}"]`)
      : null;

    scrollIntoViewIfPossible(highlight, {
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    scrollIntoViewIfPossible(listItem, {
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
    scrollIntoViewIfPossible(replyItem, {
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
    scrollIntoViewIfPossible(annotationDetailRef.current, {
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
    lastAnnotationNavigationRef.current = nextNavigationKey;
  }, [
    detail.libraryPanel,
    detail.selectedPaperId,
    detail.annotationNavigationTargetId,
    detail.selectedReplyId,
    detail.annotations,
  ]);

  useEffect(() => {
    if (detail.libraryPanel !== "discussion") {
      return;
    }

    const nextNavigationKey = [
      detail.selectedPaperId,
      detail.discussionNavigationTargetId,
      detail.selectedDiscussionReplyId,
    ].join("::");

    if (!nextNavigationKey || lastDiscussionNavigationRef.current === nextNavigationKey) {
      return;
    }

    const listItem = detail.discussionNavigationTargetId
      ? document.querySelector(`[data-discussion-id="${detail.discussionNavigationTargetId}"]`)
      : null;
    const replyItem = detail.selectedDiscussionReplyId
      ? discussionDetailRef.current?.querySelector(
          `[data-discussion-reply-id="${detail.selectedDiscussionReplyId}"]`
        )
      : null;

    scrollIntoViewIfPossible(listItem, {
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
    scrollIntoViewIfPossible(replyItem, {
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
    scrollIntoViewIfPossible(discussionDetailRef.current, {
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
    lastDiscussionNavigationRef.current = nextNavigationKey;
  }, [
    detail.libraryPanel,
    detail.selectedPaperId,
    detail.discussionNavigationTargetId,
    detail.selectedDiscussionReplyId,
    detail.discussions,
  ]);

  function handleCaptureSelection() {
    if (detail.libraryPanel !== "reader") {
      return;
    }

    const selection = capturePendingSelection(annotationRootRef.current);

    if (selection) {
      setPendingSelection(selection);
    }
  }

  if (snapshot.auth.currentUser?.mustChangePassword) {
    return (
      <main id="app-content" className="app-content">
        <button id="back-to-library-button" className="button" type="button" onClick={navigateToLibraryIndex}>
          ←返回文章和讨论列表
        </button>
        <section className="panel">
          <div className="empty-state">
            当前账号需要先回到目录页修改密码，修改完成后再查看文献与讨论。
          </div>
        </section>
      </main>
    );
  }

  return (
    <main id="app-content" className={`app-content${snapshot.auth.currentUser ? "" : " is-hidden"}`}>
      <button id="back-to-library-button" className="button" type="button" onClick={navigateToLibraryIndex}>
        ←返回文章和讨论列表
      </button>
      <section id="library-view" className="content-grid">
        <div className="library-panel-header">
          <div id="library-panel-tabs" className="library-panel-tabs" role="tablist" aria-label="阅读区切换">
            <button
              id="library-panel-reader-button"
              className={`library-panel-tab${detail.libraryPanel !== "discussion" ? " active" : ""}`}
              type="button"
              role="tab"
              aria-selected={detail.libraryPanel !== "discussion"}
              onClick={() => setLibraryPanel("reader")}
            >
              阅读与批注
            </button>
            <button
              id="library-panel-discussion-button"
              className={`library-panel-tab${detail.libraryPanel === "discussion" ? " active" : ""}`}
              type="button"
              role="tab"
              aria-selected={detail.libraryPanel === "discussion"}
              onClick={() => setLibraryPanel("discussion")}
            >
              讨论板
              <span id="discussion-count" className="annotation-count">
                （{getTopLevelDiscussions(detail.discussions).length}）
              </span>
            </button>
          </div>
        </div>

        <section className="paper-column">
          <div
            id="annotation-root"
            ref={annotationRootRef}
            className="paper-card"
            onMouseUp={handleCaptureSelection}
            onKeyUp={handleCaptureSelection}
            onClick={(event) => {
              const highlight = event.target.closest("[data-annotation-id]");

              if (highlight?.dataset?.annotationId) {
                selectAnnotationThread(highlight.dataset.annotationId);
              }
            }}
          >
            <PaperMetaCard snapshot={snapshot} />
            <article
              id="article-root"
              ref={articleRootRef}
              className="article-root"
              data-annotation-scope="body"
              dangerouslySetInnerHTML={{ __html: detail.articleHtml || renderEmptyArticleState(detail.selectedPaper) }}
            />
          </div>
        </section>

        <button
          className="pane-resizer"
          type="button"
          data-resizer="right"
          aria-label="调整右侧栏宽度"
          aria-orientation="vertical"
        ></button>

        <aside className={`sidebar${detail.libraryPanel === "discussion" ? " is-hidden" : ""}`}>
          <AnnotationComposer snapshot={snapshot} />
          <AnnotationList snapshot={snapshot} />
          <AnnotationDetail snapshot={snapshot} detailRef={annotationDetailRef} />
        </aside>

        <section id="discussion-board" className={`discussion-board${detail.libraryPanel === "discussion" ? "" : " is-hidden"}`}>
          <DiscussionComposer snapshot={snapshot} />
          <DiscussionList snapshot={snapshot} />
          <DiscussionDetail snapshot={snapshot} detailRef={discussionDetailRef} />
        </section>
      </section>
    </main>
  );
}

function PaperMetaCard({ snapshot }) {
  const paper = snapshot.detail.selectedPaper;
  const canDelete = paper && canMutateRecord(paper, snapshot.auth.currentUser);

  return (
    <div className="paper-meta">
      <div className="paper-meta-header">
        <div>
          <p id="paper-journal" className="paper-journal">
            {paper?.journal || "请选择一篇文献"}
          </p>
          <h2 id="paper-title" data-annotation-scope="title">
            {paper?.title || "返回列表选择文献后开始阅读"}
          </h2>
        </div>
        <div className="paper-meta-actions">
          <a
            id="source-link"
            className={`source-link${paper?.sourceUrl ? "" : " is-disabled"}`}
            href={paper?.sourceUrl || "#"}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!paper?.sourceUrl}
          >
            原文网址
          </a>
          <button
            id="delete-paper-button"
            className="ghost-button danger-button"
            type="button"
            disabled={!canDelete}
            onClick={async () => {
              if (!paper || !window.confirm("确定删除该文献吗？")) {
                return;
              }

              try {
                await deleteSelectedPaper();
              } catch (error) {
                window.alert(error.message || "删除文献失败，请稍后再试。");
              }
            }}
          >
            删除文献
          </button>
        </div>
      </div>
      <p id="paper-authors" className="paper-authors" data-annotation-scope="authors">
        {paper?.authors || ""}
      </p>
      <p id="paper-published" className="paper-published">
        {paper?.published ? `Published: ${paper.published}` : ""}
      </p>
      <p id="paper-owner" className="paper-owner">
        {paper?.created_by_username ? `上传者：${paper.created_by_username}` : ""}
      </p>
      <p id="paper-abstract" className="paper-abstract" data-annotation-scope="abstract">
        {paper?.abstract ? `摘要：${paper.abstract}` : ""}
      </p>
      <div id="paper-keywords" className="keyword-list">
        {(paper?.keywords || []).map((keyword) => (
          <span key={keyword} className="keyword-chip">
            {keyword}
          </span>
        ))}
      </div>
    </div>
  );
}

function AnnotationComposer({ snapshot }) {
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
    <section className="panel">
      <div className="panel-header">
        <h3>新建批注</h3>
        <span id="selection-status" className="status-pill">
          {selectionStatus}
        </span>
      </div>
      <p className="panel-tip">
        可在标题、作者、摘要或正文中选中一段文字，再填写批注并保存。批注会按当前文献 ID 关联保存。
      </p>
      <textarea
        id="annotation-input"
        rows="2"
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
      <div className="composer-actions">
        <button
          id="add-annotation-button"
          className="primary-button"
          disabled={disabled}
          onClick={async () => {
            try {
              await saveAnnotation();
            } catch (error) {
              window.alert(error.message || "批注保存失败，请稍后重试。");
            }
          }}
        >
          添加批注
        </button>
        <button
          id="cancel-annotation-button"
          className="ghost-button"
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
}

function AnnotationList({ snapshot }) {
  const detail = snapshot.detail;
  const topLevelAnnotations = getTopLevelAnnotations(detail.annotations);
  const replyCount = detail.annotations.filter((annotation) => isReply(annotation)).length;

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>当前文献批注</h3>
        <span id="annotation-count" className="annotation-count">
          {`${topLevelAnnotations.length} 条批注 / ${replyCount} 条回复`}
        </span>
        <button
          id="clear-storage-button"
          className="ghost-button"
          type="button"
          disabled={!snapshot.auth.currentUser || !detail.selectedPaper || !detail.annotations.length}
          onClick={async () => {
            if (!window.confirm("确定要清空你在当前文献下创建的全部批注吗？")) {
              return;
            }

            try {
              await clearSelectedPaperAnnotations();
            } catch (error) {
              window.alert(error.message || "清空批注失败，请稍后再试。");
            }
          }}
        >
          清空我在当前文献的批注
        </button>
      </div>
      {!topLevelAnnotations.length ? (
        <div id="annotation-list" className="annotation-list empty-state">
          还没有批注。
        </div>
      ) : (
        <div id="annotation-list" className="annotation-list">
          {topLevelAnnotations.map((annotation) => {
            const replies = getRepliesForAnnotation(detail.annotations, annotation.id);

            return (
              <button
                key={annotation.id}
                type="button"
                className={`annotation-item${detail.selectedAnnotationId === annotation.id ? " active" : ""}`}
                data-annotation-id={annotation.id}
                data-annotation-list-id={annotation.id}
                onClick={() => selectAnnotationThread(annotation.id)}
              >
                <div className="annotation-item-body">
                  <div className="annotation-item-header">
                    <strong>{annotation.created_by_username || "未知用户"}</strong>
                    <time>{formatDateTime(annotation.created_at)}</time>
                  </div>
                  <span className="annotation-target">
                    {getAnnotationScopeLabel(annotation.target_scope)} · “{truncate(annotation.exact || "", 56)}”
                  </span>
                  <p className="annotation-item-text" style={{ whiteSpace: "pre-wrap" }}>
                    {truncate(getRecordNoteDisplay(annotation), 120)}
                  </p>
                  {annotation.attachments?.length ? (
                    <span className="attachment-summary-tag">附件 {annotation.attachments.length} 个</span>
                  ) : null}
                  {replies.length ? (
                    <span className="annotation-latest-reply">回复 {replies.length} 条</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AnnotationDetail({ snapshot, detailRef }) {
  const detail = snapshot.detail;
  const selectedThread =
    getTopLevelAnnotations(detail.annotations).find(
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
    <section className="panel">
      <div className="panel-header">
        <h3>批注详情</h3>
        <div className="panel-actions">
          <button
            id="edit-annotation-button"
            className="ghost-button"
            type="button"
            disabled={!selectedThread || !canDeleteThread}
            onClick={() => startDetailEdit("annotation", selectedThread?.id, "annotation")}
          >
            编辑
          </button>
          <button
            id="delete-annotation-button"
            className="ghost-button danger-button"
            type="button"
            disabled={!selectedThread || !canDeleteThread}
            onClick={async () => {
              if (!selectedThread || !window.confirm("确定删除该批注吗？")) {
                return;
              }

              try {
                await deleteSelectedAnnotation();
              } catch (error) {
                window.alert(error.message || "删除批注失败，请稍后再试。");
              }
            }}
          >
            删除
          </button>
        </div>
      </div>
      {!selectedThread ? (
        <div id="annotation-detail" className="annotation-detail empty-state" ref={detailRef}>
          点击高亮或右侧列表项后，这里会显示批注内容与讨论线程。
        </div>
      ) : (
        <div id="annotation-detail" className="annotation-detail" ref={detailRef}>
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
            <div className="thread-list">
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
                      : null
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
                            window.alert(error.message || "删除回复失败，请稍后再试。");
                          }
                        }
                      : null
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
      <div id="reply-panel" className="reply-panel">
        <p id="reply-context" className="panel-tip">
          {activeReplyTarget
            ? `当前将回复 ${activeReplyTarget.created_by_username || "未知用户"} 的发言。`
            : "选择一条批注后可在这里继续讨论。"}
        </p>
        <textarea
          id="reply-input"
          rows="2"
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
          className="primary-button"
          type="button"
          disabled={!selectedThread || detail.isSavingReply}
          onClick={async () => {
            try {
              await saveAnnotationReply();
            } catch (error) {
              window.alert(error.message || "回复失败，请稍后重试。");
            }
          }}
        >
          回复当前批注
        </button>
      </div>
    </section>
  );
}

function DiscussionComposer({ snapshot }) {
  const detail = snapshot.detail;

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>发起讨论</h3>
        <span id="discussion-status" className="status-pill">
          {!snapshot.auth.currentUser
            ? "登录后可发布讨论"
            : !detail.selectedPaper
              ? "请选择文献"
              : detail.isSavingDiscussion
                ? "讨论发布中..."
                : "可发布讨论"}
        </span>
      </div>
      <p className="panel-tip">讨论针对整篇文章，不需要选中文本。</p>
      <textarea
        id="discussion-input"
        rows="2"
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
      <div className="composer-actions">
        <button
          id="add-discussion-button"
          className="primary-button"
          disabled={!detail.selectedPaper || detail.isSavingDiscussion}
          onClick={async () => {
            try {
              await saveDiscussion();
            } catch (error) {
              window.alert(error.message || "讨论发布失败，请稍后重试。");
            }
          }}
        >
          发布讨论
        </button>
        <button
          id="cancel-discussion-button"
          className="ghost-button"
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
}

function DiscussionList({ snapshot }) {
  const detail = snapshot.detail;
  const discussions = getTopLevelDiscussions(detail.discussions);

  return (
    <section className="panel">
      <div className="panel-header">
        <h3>当前文献讨论</h3>
      </div>
      {!discussions.length ? (
        <div id="discussion-list" className="annotation-list empty-state">
          还没有讨论。
        </div>
      ) : (
        <div id="discussion-list" className="annotation-list">
          {discussions.map((discussion) => {
            const replies = getRepliesForDiscussion(detail.discussions, discussion.id);

            return (
              <button
                key={discussion.id}
                type="button"
                className={`annotation-item${detail.selectedDiscussionId === discussion.id ? " active" : ""}`}
                data-discussion-id={discussion.id}
                onClick={() => selectDiscussionThread(discussion.id)}
              >
                <div className="annotation-item-body">
                  <div className="annotation-item-header">
                    <strong>{discussion.created_by_username || "未知用户"}</strong>
                    <time>{formatDateTime(discussion.created_at)}</time>
                  </div>
                  <p className="annotation-item-text" style={{ whiteSpace: "pre-wrap" }}>
                    {truncate(getRecordNoteDisplay(discussion), 120)}
                  </p>
                  {discussion.attachments?.length ? (
                    <span className="attachment-summary-tag">附件 {discussion.attachments.length} 个</span>
                  ) : null}
                  {replies.length ? (
                    <span className="annotation-latest-reply">回复 {replies.length} 条</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DiscussionDetail({ snapshot, detailRef }) {
  const detail = snapshot.detail;
  const selectedThread =
    getTopLevelDiscussions(detail.discussions).find(
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
    <section className="panel">
      <div className="panel-header">
        <h3>讨论详情</h3>
        <div className="panel-actions">
          <button
            id="edit-discussion-button"
            className="ghost-button"
            type="button"
            disabled={!selectedThread || !canDeleteThread}
            onClick={() => startDetailEdit("discussion", selectedThread?.id, "discussion")}
          >
            编辑
          </button>
          <button
            id="delete-discussion-button"
            className="ghost-button danger-button"
            type="button"
            disabled={!selectedThread || !canDeleteThread}
            onClick={async () => {
              if (!selectedThread || !window.confirm("确定删除该讨论吗？")) {
                return;
              }

              try {
                await deleteSelectedDiscussion();
              } catch (error) {
                window.alert(error.message || "删除讨论失败，请稍后再试。");
              }
            }}
          >
            删除
          </button>
        </div>
      </div>
      {!selectedThread ? (
        <div id="discussion-detail" className="annotation-detail empty-state" ref={detailRef}>
          点击列表项后，这里会显示讨论内容与回复线程。
        </div>
      ) : (
        <div id="discussion-detail" className="annotation-detail" ref={detailRef}>
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
            <div className="thread-list">
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
                      : null
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
                            window.alert(error.message || "删除回复失败，请稍后再试。");
                          }
                        }
                      : null
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
      <div className="reply-panel">
        <p id="discussion-reply-context" className="panel-tip">
          {activeReplyTarget
            ? `当前将回复 ${activeReplyTarget.created_by_username || "未知用户"} 的讨论。`
            : "选择一条讨论后可在这里继续回复。"}
        </p>
        <textarea
          id="discussion-reply-input"
          rows="2"
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
          className="primary-button"
          type="button"
          disabled={!selectedThread || detail.isSavingDiscussionReply}
          onClick={async () => {
            try {
              await saveDiscussionReply();
            } catch (error) {
              window.alert(error.message || "回复失败，请稍后重试。");
            }
          }}
        >
          回复当前讨论
        </button>
      </div>
    </section>
  );
}

function RecordDisplay({ compact = false, record, relationText = "" }) {
  return (
    <div className={`annotation-detail${compact ? " is-compact" : ""}`}>
      {relationText ? <h4>{relationText}</h4> : null}
      <div className="thread-reply-header">
        <strong>{record?.created_by_username || "未知用户"}</strong>
        <time>{formatDateTime(record?.created_at)}</time>
      </div>
      <p style={{ whiteSpace: "pre-wrap" }}>{getRecordNoteDisplay(record)}</p>
      <PersistedAttachmentList attachments={record?.attachments} />
    </div>
  );
}

function ThreadReplyCard({
  active = false,
  children,
  dataAttributeName,
  dataAttributeValue,
  onDelete,
  onEdit,
  onSelect,
}) {
  return (
    <div
      className={`thread-reply${active ? " active" : ""}`}
      {...(dataAttributeName ? { [dataAttributeName]: dataAttributeValue } : {})}
      onClick={onSelect}
    >
      {children}
      {onEdit || onDelete ? (
        <div className="thread-reply-actions">
          {onEdit ? (
            <button
              className="ghost-button"
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
              className="ghost-button danger-button thread-reply-delete"
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

function SpeechInlineEditor({ editState, kind, onCancel, onSave, saveButtonLabel }) {
  return (
    <div className="detail-inline-editor">
      <label className="detail-inline-editor-label" htmlFor={`${kind}-detail-editor`}>
        编辑内容
      </label>
      <textarea
        id={`${kind}-detail-editor`}
        className="detail-inline-editor-input"
        value={editState.draft}
        onInput={(event) => setDetailEditDraft(kind, event.currentTarget.value)}
      ></textarea>
      <AttachmentEditor
        kind={kind}
        items={editState.attachments}
        disabled={editState.isSaving}
        onAddFiles={(files) => addDetailEditAttachments(kind, files)}
        onRemoveItem={(key) => removeDetailEditAttachment(kind, key)}
        onClear={() => clearDetailEditAttachments(kind)}
      />
      <div className="detail-inline-editor-actions composer-actions">
        <button
          className="primary-button"
          type="button"
          disabled={editState.isSaving}
          onClick={async () => {
            try {
              await onSave();
            } catch (error) {
              window.alert(error.message || "保存失败，请稍后再试。");
            }
          }}
        >
          {saveButtonLabel}
        </button>
        <button className="ghost-button" type="button" disabled={editState.isSaving} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

function AttachmentComposer({
  disabled = false,
  files,
  idPrefix,
  onAddFiles,
  onClear,
  onRemoveFile,
}) {
  return (
    <div className="attachment-composer">
      <label className="field">
        <span>附件（支持图片与表格，可多选）</span>
        <input
          id={`${idPrefix}-attachments`}
          type="file"
          accept={ATTACHMENT_INPUT_ACCEPT}
          multiple
          disabled={disabled}
          onChange={(event) => {
            const nextFiles = Array.from(event.currentTarget.files || []);

            if (!nextFiles.length) {
              return;
            }

            try {
              onAddFiles(nextFiles);
            } catch (error) {
              window.alert(error.message || "附件不符合上传要求。");
            } finally {
              event.currentTarget.value = "";
            }
          }}
        />
      </label>
      <div className="attachment-composer-actions">
        <p className="panel-tip attachment-tip">
          支持 PNG、JPG、GIF、WEBP、BMP、CSV、TSV、XLS、XLSX、ODS。
        </p>
        <button id={`clear-${idPrefix}-attachments-button`} className="ghost-button" type="button" onClick={onClear}>
          清空附件
        </button>
      </div>
      <ComposerAttachmentPreview id={`${idPrefix}-attachments-preview`} files={files} onRemove={onRemoveFile} />
    </div>
  );
}

function ComposerAttachmentPreview({ files, id, onRemove }) {
  if (!files?.length) {
    return (
      <div id={id} className="composer-attachment-preview empty-state">
        还没有选择附件。
      </div>
    );
  }

  return (
    <div id={id} className="composer-attachment-preview">
      {files.map((file, index) => (
        <div key={`${file.name}-${file.size}-${index}`} className="composer-attachment-chip">
          <div className="composer-attachment-chip-body">
            <strong>{file.name}</strong>
            <span>
              {getAttachmentCategoryLabel(file)} · {formatFileSize(file.size || 0)}
            </span>
          </div>
          <button
            className="composer-attachment-remove"
            type="button"
            onClick={() => onRemove(index)}
          >
            删除
          </button>
        </div>
      ))}
    </div>
  );
}

function AttachmentEditor({ disabled = false, items, kind, onAddFiles, onClear, onRemoveItem }) {
  const inputId = `${kind}-detail-attachments`;

  return (
    <div className="attachment-composer">
      <label className="field">
        <span>附件</span>
        <input
          id={inputId}
          type="file"
          accept={ATTACHMENT_INPUT_ACCEPT}
          multiple
          disabled={disabled}
          onChange={(event) => {
            const nextFiles = Array.from(event.currentTarget.files || []);

            if (!nextFiles.length) {
              return;
            }

            try {
              onAddFiles(nextFiles);
            } catch (error) {
              window.alert(error.message || "附件不符合上传要求。");
            } finally {
              event.currentTarget.value = "";
            }
          }}
        />
      </label>
      <div className="attachment-composer-actions">
        <p className="panel-tip attachment-tip">可保留已有附件，也可继续追加新的附件。</p>
        <button className="ghost-button" type="button" onClick={onClear}>
          清空附件
        </button>
      </div>
      {!items?.length ? (
        <div className="composer-attachment-preview empty-state">还没有选择附件。</div>
      ) : (
        <div className="composer-attachment-preview">
          {items.map((item) => (
            <div key={item.key} className="composer-attachment-chip">
              <div className="composer-attachment-chip-body">
                <strong>
                  {item.kind === "existing"
                    ? item.attachment?.original_name || item.attachment?.filename || "未命名附件"
                    : item.file?.name || "未命名附件"}
                </strong>
                <span>
                  {item.kind === "existing"
                    ? `${getAttachmentCategoryLabel(item.attachment)} · ${formatFileSize(
                        item.attachment?.size_bytes || 0
                      )}`
                    : `${getAttachmentCategoryLabel(item.file)} · ${formatFileSize(item.file?.size || 0)}`}
                </span>
              </div>
              <button className="composer-attachment-remove" type="button" onClick={() => onRemoveItem(item.key)}>
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PersistedAttachmentList({ attachments }) {
  if (!attachments?.length) {
    return null;
  }

  return (
    <div className="record-attachment-list">
      {attachments.map((attachment) => {
        const attachmentUrl = buildAttachmentUrl(attachment, buildApiUrl);
        const attachmentName =
          attachment?.original_name || attachment?.filename || "未命名附件";
        const attachmentMeta = `${getAttachmentCategoryLabel(attachment)} · ${formatFileSize(
          attachment?.size_bytes || attachment?.size || 0
        )}`;
        const isImage = getAttachmentCategory(attachment) === "image";

        return (
          <a
            key={attachment.id || attachment.storage_path || attachment.url || attachmentName}
            className={`record-attachment-card${isImage ? " is-image" : ""}`}
            href={attachmentUrl}
            target="_blank"
            rel="noreferrer"
            download={isImage ? undefined : true}
          >
            {isImage ? <img src={attachmentUrl} alt={attachmentName} loading="lazy" /> : <strong>{attachmentName}</strong>}
            <span>{attachmentName}</span>
            <span>{attachmentMeta}</span>
          </a>
        );
      })}
    </div>
  );
}

function renderEmptyArticleState(selectedPaper) {
  if (selectedPaper) {
    return '<div class="empty-state">当前文献没有可展示的网页快照。</div>';
  }

  return '<div class="empty-state">当前还没有选中文献。抓取成功后，文献详情和网页快照会从运行时存储目录加载。</div>';
}

function isReply(annotation) {
  return Boolean(String(annotation?.parent_annotation_id || "").trim());
}

function truncate(value, maxLength) {
  const normalizedValue = String(value || "");

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}...`;
}

function scrollIntoViewIfPossible(element, options) {
  if (typeof element?.scrollIntoView !== "function") {
    return;
  }

  element.scrollIntoView(options);
}
