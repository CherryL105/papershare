const {
  canDeleteOwnedRecord,
  doesRecordBelongToUser,
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  isDiscussionReply,
  isReplyAnnotation,
} = require("../../../shared/papershare-shared");

function createSpeechService(deps) {
  async function getAnnotationById(annotationId) {
    const annotation = deps.store.annotations.getById(annotationId);
    return annotation ? deps.normalizeAnnotationRecord(annotation) : null;
  }

  async function getDiscussionById(discussionId) {
    const discussion = deps.store.discussions.getById(discussionId);
    return discussion ? deps.normalizeDiscussionRecord(discussion) : null;
  }

  async function getAnnotationsByPaperId(paperId) {
    return deps.store.annotations
      .listByPaperId(paperId)
      .map((annotation) => deps.normalizeAnnotationRecord(annotation));
  }

  async function getDiscussionsByPaperId(paperId) {
    return deps.store.discussions
      .listByPaperId(paperId)
      .map((discussion) => deps.normalizeDiscussionRecord(discussion));
  }

  async function getAnnotationsByUserId(user) {
    if (deps.dashboardService?.getForUser) {
      const dashboard = await deps.dashboardService.getForUser(user);
      return dashboard.myAnnotations;
    }

    return deps.store.annotations
      .listByUserId(String(user?.id || "").trim())
      .map((annotation) => deps.normalizeAnnotationRecord(annotation));
  }

  async function saveAnnotation(paperId, body, currentUser) {
    const note = String(body.note || "").trim();
    const exact = String(body.exact || "");
    const prefix = String(body.prefix || "");
    const suffix = String(body.suffix || "");
    const targetScope = String(body.target_scope || "body").trim() || "body";
    const startOffset = Number(body.start_offset);
    const endOffset = Number(body.end_offset);
    const attachmentDrafts = parseAttachmentDrafts(body.attachments);

    if (!note && attachmentDrafts.length === 0) {
      throw new Error("批注内容和附件不能同时为空");
    }

    if (!exact.trim()) {
      throw new Error("批注锚点不能为空");
    }

    if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || startOffset >= endOffset) {
      throw new Error("批注偏移量不合法");
    }

    const attachments = await persistAttachmentDrafts(attachmentDrafts);

    try {
      const normalizedAnnotation = deps.normalizeAnnotationRecord({
        id: deps.createAnnotationId(),
        paperId,
        note,
        exact,
        prefix,
        suffix,
        target_scope: targetScope,
        start_offset: startOffset,
        end_offset: endOffset,
        created_by_user_id: currentUser.id,
        created_by_username: currentUser.username,
        created_at: new Date().toISOString(),
        parent_annotation_id: "",
        root_annotation_id: "",
        attachments,
      });

      deps.store.runInTransaction((repositories) => {
        repositories.annotations.insert(normalizedAnnotation);
        refreshPaperActivities(repositories, [paperId]);
      });
      return normalizedAnnotation;
    } catch (error) {
      await deleteAttachmentFiles(attachments);
      throw error;
    }
  }

  async function saveAnnotationReply(annotationId, body, currentUser) {
    const note = String(body.note || "").trim();
    const attachmentDrafts = parseAttachmentDrafts(body.attachments);

    if (!note && attachmentDrafts.length === 0) {
      throw new Error("回复内容和附件不能同时为空");
    }

    const parentAnnotation = await getAnnotationById(annotationId);

    if (!parentAnnotation) {
      throw new deps.HttpError(404, "批注不存在");
    }

    const rootAnnotation =
      (await getAnnotationById(getThreadRootAnnotationId(parentAnnotation))) || parentAnnotation;
    const attachments = await persistAttachmentDrafts(attachmentDrafts);

    try {
      const nextReply = deps.normalizeAnnotationRecord({
        id: deps.createAnnotationId(),
        paperId: parentAnnotation.paperId,
        note,
        exact: rootAnnotation.exact,
        prefix: rootAnnotation.prefix,
        suffix: rootAnnotation.suffix,
        target_scope: rootAnnotation.target_scope,
        start_offset: rootAnnotation.start_offset,
        end_offset: rootAnnotation.end_offset,
        created_by_user_id: currentUser.id,
        created_by_username: currentUser.username,
        created_at: new Date().toISOString(),
        parent_annotation_id: parentAnnotation.id,
        root_annotation_id: rootAnnotation.id,
        attachments,
      });

      deps.store.runInTransaction((repositories) => {
        repositories.annotations.insert(nextReply);
        refreshPaperActivities(repositories, [parentAnnotation.paperId]);
      });
      return nextReply;
    } catch (error) {
      await deleteAttachmentFiles(attachments);
      throw error;
    }
  }

  async function saveDiscussion(paperId, body, currentUser) {
    const note = String(body.note || "").trim();
    const attachmentDrafts = parseAttachmentDrafts(body.attachments);

    if (!note && attachmentDrafts.length === 0) {
      throw new Error("讨论内容和附件不能同时为空");
    }

    const attachments = await persistAttachmentDrafts(attachmentDrafts);

    try {
      const nextDiscussion = deps.normalizeDiscussionRecord({
        id: deps.createDiscussionId(),
        paperId,
        note,
        created_by_user_id: currentUser.id,
        created_by_username: currentUser.username,
        created_at: new Date().toISOString(),
        parent_discussion_id: "",
        root_discussion_id: "",
        attachments,
      });

      deps.store.runInTransaction((repositories) => {
        repositories.discussions.insert(nextDiscussion);
        refreshPaperActivities(repositories, [paperId]);
      });
      return nextDiscussion;
    } catch (error) {
      await deleteAttachmentFiles(attachments);
      throw error;
    }
  }

  async function saveDiscussionReply(discussionId, body, currentUser) {
    const note = String(body.note || "").trim();
    const attachmentDrafts = parseAttachmentDrafts(body.attachments);

    if (!note && attachmentDrafts.length === 0) {
      throw new Error("回复内容和附件不能同时为空");
    }

    const parentDiscussion = await getDiscussionById(discussionId);

    if (!parentDiscussion) {
      throw new deps.HttpError(404, "讨论不存在");
    }

    const rootDiscussion =
      (await getDiscussionById(getThreadRootDiscussionId(parentDiscussion))) || parentDiscussion;
    const attachments = await persistAttachmentDrafts(attachmentDrafts);

    try {
      const nextReply = deps.normalizeDiscussionRecord({
        id: deps.createDiscussionId(),
        paperId: parentDiscussion.paperId,
        note,
        created_by_user_id: currentUser.id,
        created_by_username: currentUser.username,
        created_at: new Date().toISOString(),
        parent_discussion_id: parentDiscussion.id,
        root_discussion_id: rootDiscussion.id,
        attachments,
      });

      deps.store.runInTransaction((repositories) => {
        repositories.discussions.insert(nextReply);
        refreshPaperActivities(repositories, [parentDiscussion.paperId]);
      });
      return nextReply;
    } catch (error) {
      await deleteAttachmentFiles(attachments);
      throw error;
    }
  }

  async function updateAnnotationById(annotationId, body, currentUser) {
    const note = String(body.note || "").trim();
    const annotation = await getAnnotationById(annotationId);

    if (!annotation) {
      throw new deps.HttpError(404, "批注不存在");
    }

    if (!canDeleteOwnedRecord(annotation, currentUser)) {
      throw new deps.HttpError(
        403,
        isReplyAnnotation(annotation) ? "无权编辑该回复" : "无权编辑该批注"
      );
    }

    const { attachments, createdAttachments, deletedAttachments } = await resolveUpdatedAttachments(
      body.attachments,
      annotation.attachments
    );

    if (!note && attachments.length === 0) {
      throw new Error("批注内容和附件不能同时为空");
    }

    const updatedAnnotation = deps.normalizeAnnotationRecord({
      ...annotation,
      note,
      attachments,
    });

    try {
      deps.store.annotations.update(updatedAnnotation);
    } catch (error) {
      await deleteAttachmentFiles(createdAttachments);
      throw error;
    }

    await deleteAttachmentFiles(deletedAttachments);
    return updatedAnnotation;
  }

  async function updateDiscussionById(discussionId, body, currentUser) {
    const note = String(body.note || "").trim();
    const discussion = await getDiscussionById(discussionId);

    if (!discussion) {
      throw new deps.HttpError(404, "讨论不存在");
    }

    if (!canDeleteOwnedRecord(discussion, currentUser)) {
      throw new deps.HttpError(
        403,
        isDiscussionReply(discussion) ? "无权编辑该回复" : "无权编辑该讨论"
      );
    }

    const { attachments, createdAttachments, deletedAttachments } = await resolveUpdatedAttachments(
      body.attachments,
      discussion.attachments
    );

    if (!note && attachments.length === 0) {
      throw new Error("讨论内容和附件不能同时为空");
    }

    const updatedDiscussion = deps.normalizeDiscussionRecord({
      ...discussion,
      note,
      attachments,
    });

    try {
      deps.store.discussions.update(updatedDiscussion);
    } catch (error) {
      await deleteAttachmentFiles(createdAttachments);
      throw error;
    }

    await deleteAttachmentFiles(deletedAttachments);
    return updatedDiscussion;
  }

  async function deleteAnnotationById(annotationId, currentUser) {
    const annotation = await getAnnotationById(annotationId);

    if (!annotation) {
      throw new deps.HttpError(404, "批注不存在");
    }

    if (!canDeleteOwnedRecord(annotation, currentUser)) {
      throw new deps.HttpError(403, "无权删除该批注");
    }

    const deletedIds = new Set([annotationId]);
    let deletedRecords = [annotation];

    deps.store.runInTransaction((repositories) => {
      if (!isReplyAnnotation(annotation)) {
        const replyRecords = repositories.annotations
          .listByRootId(annotationId)
          .map((record) => deps.normalizeAnnotationRecord(record));
        deletedRecords = dedupeRecordsById([annotation, ...replyRecords]);
        deletedRecords.forEach((record) => deletedIds.add(record.id));
        repositories.annotations.deleteByIds(Array.from(deletedIds));
        refreshPaperActivities(repositories, [annotation.paperId]);
        return;
      }

      const fallbackParentId =
        String(annotation.parent_annotation_id || "").trim() || getThreadRootAnnotationId(annotation);
      repositories.annotations.reparentChildren(annotationId, fallbackParentId);
      repositories.annotations.deleteById(annotationId);
      refreshPaperActivities(repositories, [annotation.paperId]);
    });

    await deleteAttachmentsForRecords(deletedRecords);

    return {
      ok: true,
      annotationId,
      paperId: annotation.paperId,
      deletedCount: deletedIds.size,
    };
  }

  async function deleteDiscussionById(discussionId, currentUser) {
    const discussion = await getDiscussionById(discussionId);

    if (!discussion) {
      throw new deps.HttpError(404, "讨论不存在");
    }

    if (!canDeleteOwnedRecord(discussion, currentUser)) {
      throw new deps.HttpError(403, "无权删除该讨论");
    }

    const deletedIds = new Set([discussionId]);
    let deletedRecords = [discussion];

    deps.store.runInTransaction((repositories) => {
      if (!isDiscussionReply(discussion)) {
        const replyRecords = repositories.discussions
          .listByRootId(discussionId)
          .map((record) => deps.normalizeDiscussionRecord(record));
        deletedRecords = dedupeRecordsById([discussion, ...replyRecords]);
        deletedRecords.forEach((record) => deletedIds.add(record.id));
        repositories.discussions.deleteByIds(Array.from(deletedIds));
        refreshPaperActivities(repositories, [discussion.paperId]);
        return;
      }

      const fallbackParentId =
        String(discussion.parent_discussion_id || "").trim() ||
        getThreadRootDiscussionId(discussion);
      repositories.discussions.reparentChildren(discussionId, fallbackParentId);
      repositories.discussions.deleteById(discussionId);
      refreshPaperActivities(repositories, [discussion.paperId]);
    });

    await deleteAttachmentsForRecords(deletedRecords);

    return {
      ok: true,
      discussionId,
      paperId: discussion.paperId,
      deletedCount: deletedIds.size,
    };
  }

  async function clearAnnotationsByPaperId(paperId, currentUser) {
    const annotations = await getAnnotationsByPaperId(paperId);
    const ownedThreadIds = new Set(
      annotations
        .filter(
          (annotation) =>
            annotation.paperId === paperId &&
            !isReplyAnnotation(annotation) &&
            doesRecordBelongToUser(annotation, currentUser)
        )
        .map((annotation) => annotation.id)
    );
    const ownedReplyIds = new Set(
      annotations
        .filter(
          (annotation) =>
            annotation.paperId === paperId &&
            isReplyAnnotation(annotation) &&
            doesRecordBelongToUser(annotation, currentUser)
        )
        .map((annotation) => annotation.id)
    );
    const deletedAnnotations = [];

    deps.store.runInTransaction((repositories) => {
      ownedThreadIds.forEach((threadId) => {
        const rootAnnotation = repositories.annotations.getById(threadId);

        if (!rootAnnotation) {
          return;
        }

        const threadRecords = dedupeRecordsById([
          deps.normalizeAnnotationRecord(rootAnnotation),
          ...repositories.annotations
            .listByRootId(threadId)
            .map((record) => deps.normalizeAnnotationRecord(record)),
        ]);

        deletedAnnotations.push(...threadRecords);
        repositories.annotations.deleteByIds(threadRecords.map((record) => record.id));
      });

      ownedReplyIds.forEach((replyId) => {
        const reply = repositories.annotations.getById(replyId);

        if (!reply) {
          return;
        }

        const normalizedReply = deps.normalizeAnnotationRecord(reply);
        const fallbackParentId =
          String(normalizedReply.parent_annotation_id || "").trim() ||
          getThreadRootAnnotationId(normalizedReply);

        repositories.annotations.reparentChildren(replyId, fallbackParentId);
        repositories.annotations.deleteById(replyId);
        deletedAnnotations.push(normalizedReply);
      });

      refreshPaperActivities(repositories, [paperId]);
    });

    const normalizedDeletedAnnotations = dedupeRecordsById(deletedAnnotations);
    await deleteAttachmentsForRecords(normalizedDeletedAnnotations);
    return normalizedDeletedAnnotations.length;
  }

  function refreshPaperActivities(repositories, paperIds) {
    repositories.papers.refreshActivitiesByIds(paperIds);
  }

  function parseAttachmentDrafts(rawAttachments) {
    if (rawAttachments == null) {
      return [];
    }

    if (!Array.isArray(rawAttachments)) {
      throw new Error("附件格式不合法");
    }

    if (rawAttachments.length > deps.maxAttachmentCount) {
      throw new Error(`单次最多上传 ${deps.maxAttachmentCount} 个附件`);
    }

    let totalBytes = 0;

    return rawAttachments.map((attachment, index) => {
      const draft = parseAttachmentDraft(attachment, index, totalBytes);
      totalBytes += draft.sizeBytes;
      return draft;
    });
  }

  function parseAttachmentDraft(rawAttachment, index, currentTotalBytes = 0) {
    const originalName = sanitizeAttachmentName(
      rawAttachment?.name || rawAttachment?.original_name || ""
    );
    const contentBase64 = stripBase64Prefix(
      rawAttachment?.contentBase64 || rawAttachment?.content_base64 || ""
    );
    const multipartBuffer = Buffer.isBuffer(rawAttachment?.buffer) ? rawAttachment.buffer : null;

    if (!originalName) {
      throw new Error(`第 ${index + 1} 个附件缺少文件名`);
    }

    if (!contentBase64 && !multipartBuffer) {
      throw new Error(`第 ${index + 1} 个附件缺少文件内容`);
    }

    let fileBuffer;

    if (multipartBuffer) {
      fileBuffer = multipartBuffer;
    } else {
      try {
        fileBuffer = Buffer.from(contentBase64, "base64");
      } catch (error) {
        throw new Error(`第 ${index + 1} 个附件内容无法解析`);
      }
    }

    if (!fileBuffer.length) {
      throw new Error(`第 ${index + 1} 个附件内容为空`);
    }

    if (fileBuffer.length > deps.maxAttachmentBytes) {
      throw new Error(
        `附件“${originalName}”超过 ${deps.formatLimitInMb(deps.maxAttachmentBytes)} MB 限制`
      );
    }

    if (currentTotalBytes + fileBuffer.length > deps.maxTotalAttachmentBytes) {
      throw new Error(
        `附件总大小不能超过 ${deps.formatLimitInMb(deps.maxTotalAttachmentBytes)} MB`
      );
    }

    const { category, extension, mimeType } = deps.resolveAttachmentDescriptor(
      originalName,
      rawAttachment?.mimeType || rawAttachment?.mime_type || ""
    );

    return {
      originalName,
      category,
      extension,
      mimeType,
      sizeBytes: fileBuffer.length,
      buffer: fileBuffer,
    };
  }

  function getAttachmentLookupKeys(attachment) {
    const normalizedAttachment = deps.normalizeAttachmentRecord(attachment);

    return [normalizedAttachment.id, normalizedAttachment.storage_path, normalizedAttachment.url].filter(
      Boolean
    );
  }

  function resolveCurrentAttachmentSelection(rawAttachment, existingAttachmentsByKey) {
    for (const key of getAttachmentLookupKeys(rawAttachment)) {
      const matchedAttachment = existingAttachmentsByKey.get(key);

      if (matchedAttachment) {
        return matchedAttachment;
      }
    }

    return null;
  }

  async function resolveUpdatedAttachments(rawAttachments, currentAttachments) {
    const existingAttachments = deps.normalizeAttachmentRecords(currentAttachments);

    if (rawAttachments == null) {
      return {
        attachments: existingAttachments,
        createdAttachments: [],
        deletedAttachments: [],
      };
    }

    if (!Array.isArray(rawAttachments)) {
      throw new Error("附件格式不合法");
    }

    if (rawAttachments.length > deps.maxAttachmentCount) {
      throw new Error(`单次最多上传 ${deps.maxAttachmentCount} 个附件`);
    }

    const existingAttachmentsByKey = new Map();

    existingAttachments.forEach((attachment) => {
      getAttachmentLookupKeys(attachment).forEach((key) => {
        existingAttachmentsByKey.set(key, attachment);
      });
    });

    let totalBytes = 0;
    const retainedAttachments = [];
    const retainedStoragePaths = new Set();
    const attachmentDrafts = [];

    rawAttachments.forEach((attachment, index) => {
      const retainedAttachment = resolveCurrentAttachmentSelection(
        attachment,
        existingAttachmentsByKey
      );

      if (retainedAttachment) {
        if (retainedStoragePaths.has(retainedAttachment.storage_path)) {
          return;
        }

        totalBytes += retainedAttachment.size_bytes || 0;

        if (totalBytes > deps.maxTotalAttachmentBytes) {
          throw new Error(
            `附件总大小不能超过 ${deps.formatLimitInMb(deps.maxTotalAttachmentBytes)} MB`
          );
        }

        retainedAttachments.push(retainedAttachment);
        retainedStoragePaths.add(retainedAttachment.storage_path);
        return;
      }

      const draft = parseAttachmentDraft(attachment, index, totalBytes);
      totalBytes += draft.sizeBytes;
      attachmentDrafts.push(draft);
    });

    const createdAttachments = await persistAttachmentDrafts(attachmentDrafts);

    return {
      attachments: [...retainedAttachments, ...createdAttachments],
      createdAttachments,
      deletedAttachments: existingAttachments.filter(
        (attachment) => !retainedStoragePaths.has(attachment.storage_path)
      ),
    };
  }

  async function persistAttachmentDrafts(attachmentDrafts) {
    if (!attachmentDrafts.length) {
      return [];
    }

    await deps.fs.mkdir(deps.attachmentsDir, { recursive: true });

    const createdAttachments = [];

    try {
      for (const draft of attachmentDrafts) {
        const attachmentId = deps.createAttachmentId();
        const storedFilename = `${attachmentId}${draft.extension}`;
        const storagePath = deps.path.posix.join("attachments", storedFilename);
        const absolutePath = deps.resolveStorageAbsolutePath(storagePath);
        const createdAt = new Date().toISOString();

        await deps.fs.writeFile(absolutePath, draft.buffer);

        createdAttachments.push(
          deps.normalizeAttachmentRecord({
            id: attachmentId,
            category: draft.category,
            filename: storedFilename,
            original_name: draft.originalName,
            mime_type: draft.mimeType,
            extension: draft.extension,
            size_bytes: draft.sizeBytes,
            storage_path: storagePath,
            created_at: createdAt,
          })
        );
      }
    } catch (error) {
      await deleteAttachmentFiles(createdAttachments);
      throw error;
    }

    return createdAttachments;
  }

  async function deleteAttachmentsForRecords(records) {
    const attachments = [];

    for (const record of records || []) {
      attachments.push(...deps.normalizeAttachmentRecords(record?.attachments));
    }

    await deleteAttachmentFiles(attachments);
  }

  async function deleteAttachmentFiles(attachments) {
    const uniqueStoragePaths = [
      ...new Set(
        deps.normalizeAttachmentRecords(attachments).map((attachment) => attachment.storage_path)
      ),
    ].filter(Boolean);

    await Promise.all(
      uniqueStoragePaths.map(async (storagePath) => {
        const absolutePath = deps.resolveStorageAbsolutePath(storagePath);

        try {
          await deps.fs.unlink(absolutePath);
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }
      })
    );
  }

  return {
    clearAnnotationsByPaperId,
    deleteAnnotationById,
    deleteAttachmentsForRecords,
    deleteDiscussionById,
    getAnnotationById,
    getAnnotationsByPaperId,
    getAnnotationsByUserId,
    getDiscussionById,
    getDiscussionsByPaperId,
    readMutationBody: deps.readSpeechMutationBody,
    saveAnnotation,
    saveAnnotationReply,
    saveDiscussion,
    saveDiscussionReply,
    updateAnnotationById,
    updateDiscussionById,
  };
}

function stripBase64Prefix(value) {
  return String(value || "").replace(/^data:[^;,]+;base64,/i, "").trim();
}

function sanitizeAttachmentName(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return "";
  }

  return require("path")
    .basename(trimmed)
    .replace(/[^\w.\-()\u4e00-\u9fa5 ]+/g, "_")
    .slice(0, 120);
}

function dedupeRecordsById(records) {
  const seenIds = new Set();

  return (Array.isArray(records) ? records : []).filter((record) => {
    const recordId = String(record?.id || "").trim();

    if (!recordId || seenIds.has(recordId)) {
      return false;
    }

    seenIds.add(recordId);
    return true;
  });
}

module.exports = {
  createSpeechService,
};
