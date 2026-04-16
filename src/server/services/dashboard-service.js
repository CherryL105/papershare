const {
  getThreadRootAnnotationId,
  getThreadRootDiscussionId,
  getUserRole,
  isDiscussionReply,
  isReplyAnnotation,
} = require("../../../shared/papershare-shared");

function createDashboardService(deps) {
  const normalizeAnnotationRecord = deps.normalizeAnnotationRecord || ((value) => value);
  const normalizeDiscussionRecord = deps.normalizeDiscussionRecord || ((value) => value);
  const normalizePaperRecord = deps.normalizePaperRecord || ((value) => value);
  const dashboardCacheByUserId = new Map();
  let usersWithStatsCache = null;

  async function getForUser(user) {
    const userId = normalizeText(user?.id);

    if (!userId) {
      return {
        myAnnotations: [],
        repliesToMyAnnotations: [],
        uploadedPapers: [],
      };
    }

    const cachedDashboard = dashboardCacheByUserId.get(userId);

    if (cachedDashboard) {
      return cachedDashboard;
    }

    const db = deps.store.getDatabase();
    const uploadedPapers = deps.store.papers.listByUserId(userId).map((paper) => ({
      ...normalizePaperRecord(paper),
      activity_at: paper.updatedAt || paper.createdAt || paper.fetchedAt || "",
    }));
    const ownedAnnotationRecords = deps.store.annotations
      .listByUserId(userId)
      .map((annotation) => normalizeAnnotationRecord(annotation));
    const ownedDiscussionRecords = deps.store.discussions
      .listByUserId(userId)
      .map((discussion) => normalizeDiscussionRecord(discussion));
    const replyAnnotationRecords = queryJsonRows(
      db,
      `
        SELECT child.json
        FROM annotations child
        JOIN annotations parent ON parent.id = child.parent_annotation_id
        WHERE child.parent_annotation_id <> ''
          AND child.created_by_user_id <> ''
          AND child.created_by_user_id <> ?
          AND parent.created_by_user_id = ?
      `,
      [userId, userId]
    ).map((annotation) => normalizeAnnotationRecord(annotation));
    const replyDiscussionRecords = queryJsonRows(
      db,
      `
        SELECT child.json
        FROM discussions child
        JOIN discussions parent ON parent.id = child.parent_discussion_id
        WHERE child.parent_discussion_id <> ''
          AND child.created_by_user_id <> ''
          AND child.created_by_user_id <> ?
          AND parent.created_by_user_id = ?
      `,
      [userId, userId]
    ).map((discussion) => normalizeDiscussionRecord(discussion));
    const annotationSupportIds = collectRelatedRecordIds(
      [...ownedAnnotationRecords, ...replyAnnotationRecords],
      ["id", "parent_annotation_id", "root_annotation_id"]
    );
    const discussionSupportIds = collectRelatedRecordIds(
      [...ownedDiscussionRecords, ...replyDiscussionRecords],
      ["id", "parent_discussion_id", "root_discussion_id"]
    );
    const relatedAnnotationRecords = deps.store.annotations
      .listByIds(annotationSupportIds)
      .map((annotation) => normalizeAnnotationRecord(annotation));
    const relatedDiscussionRecords = deps.store.discussions
      .listByIds(discussionSupportIds)
      .map((discussion) => normalizeDiscussionRecord(discussion));
    const paperIds = collectRelatedPaperIds([
      ...uploadedPapers,
      ...ownedAnnotationRecords,
      ...ownedDiscussionRecords,
      ...replyAnnotationRecords,
      ...replyDiscussionRecords,
    ]);
    const papers = deps.store.papers.listByIds(paperIds).map((paper) => normalizePaperRecord(paper));
    const papersById = new Map(papers.map((paper) => [paper.id, paper]));
    const annotationsById = new Map(relatedAnnotationRecords.map((annotation) => [annotation.id, annotation]));
    const discussionsById = new Map(relatedDiscussionRecords.map((discussion) => [discussion.id, discussion]));
    const myAnnotations = [];
    const repliesToMyAnnotations = [];

    ownedAnnotationRecords.forEach((annotation) => {
      myAnnotations.push(serializeAnnotationActivity(annotation, papersById, annotationsById));
    });

    replyAnnotationRecords.forEach((annotation) => {
      repliesToMyAnnotations.push(
        serializeReplyNotification(annotation, papersById, annotationsById)
      );
    });

    ownedDiscussionRecords.forEach((discussion) => {
      myAnnotations.push(serializeDiscussionActivity(discussion, papersById, discussionsById));
    });

    replyDiscussionRecords.forEach((discussion) => {
      repliesToMyAnnotations.push(
        serializeDiscussionReplyNotification(discussion, papersById, discussionsById)
      );
    });

    uploadedPapers.sort(compareRecordsByActivityDesc("activity_at"));
    myAnnotations.sort(compareRecordsByActivityDesc("activity_at"));
    repliesToMyAnnotations.sort(compareRecordsByActivityDesc("activity_at"));

    const dashboard = {
      myAnnotations,
      repliesToMyAnnotations,
      uploadedPapers,
    };

    dashboardCacheByUserId.set(userId, dashboard);
    return dashboard;
  }

  async function listUsersWithStats() {
    if (usersWithStatsCache) {
      return usersWithStatsCache;
    }

    const db = deps.store.getDatabase();
    const users = deps.store.users.listAll();
    const uploadedPaperCountsByUserId = createCountMapFromRows(
      db
        .prepare(
          `
            SELECT created_by_user_id AS lookup_key, COUNT(*) AS count
            FROM papers
            WHERE created_by_user_id <> ''
            GROUP BY created_by_user_id
          `
        )
        .all()
    );
    const speechCountsByUserId = createCountMapFromRows(
      db
        .prepare(
          `
            SELECT lookup_key, SUM(count) AS count
            FROM (
              SELECT created_by_user_id AS lookup_key, COUNT(*) AS count
              FROM annotations
              WHERE created_by_user_id <> ''
              GROUP BY created_by_user_id
              UNION ALL
              SELECT created_by_user_id AS lookup_key, COUNT(*) AS count
              FROM discussions
              WHERE created_by_user_id <> ''
              GROUP BY created_by_user_id
            )
            GROUP BY lookup_key
          `
        )
        .all()
    );

    const userStats = users
      .map((user) => ({
        ...deps.serializeUser(user),
        annotationCount: Number(speechCountsByUserId.get(normalizeText(user?.id)) || 0),
        uploadedPaperCount: Number(uploadedPaperCountsByUserId.get(normalizeText(user?.id)) || 0),
      }))
      .sort(compareUsersForDisplay);

    usersWithStatsCache = userStats;
    return userStats;
  }

  async function getPublicUserProfile(userId) {
    const user = deps.store.users.getById(userId);

    if (!user) {
      throw new deps.HttpError(404, "用户不存在");
    }

    const dashboard = await getForUser(user);

    return {
      annotations: dashboard.myAnnotations,
      uploadedPapers: dashboard.uploadedPapers,
      user: deps.serializeUser(user),
    };
  }

  function invalidateAll() {
    dashboardCacheByUserId.clear();
    usersWithStatsCache = null;
  }

  return {
    getForUser,
    getPublicUserProfile,
    invalidateAll,
    listUsersWithStats,
  };
}

function queryJsonRows(db, query, params = []) {
  return db
    .prepare(query)
    .all(...params)
    .map((row) => JSON.parse(row.json));
}

function createCountMapFromRows(rows) {
  const counts = new Map();

  rows.forEach((row) => {
    const key = normalizeText(row?.lookup_key);

    if (!key) {
      return;
    }

    counts.set(key, Number(row?.count || 0));
  });

  return counts;
}

function collectRelatedRecordIds(records, idKeys) {
  const ids = new Set();

  records.forEach((record) => {
    idKeys.forEach((key) => {
      const value = normalizeText(record?.[key]);

      if (value) {
        ids.add(value);
      }
    });
  });

  return Array.from(ids);
}

function collectRelatedPaperIds(records) {
  const ids = new Set();

  records.forEach((record) => {
    const paperId = normalizeText(record?.paperId);
    const recordId = normalizeText(record?.id);

    if (paperId) {
      ids.add(paperId);
      return;
    }

    if (recordId && normalizeText(record?.sourceUrl)) {
      ids.add(recordId);
    }
  });

  return Array.from(ids);
}

function serializeAnnotationActivity(annotation, papersById, annotationsById) {
  const paper = papersById.get(annotation.paperId) || null;
  const rootAnnotation = annotationsById.get(getThreadRootAnnotationId(annotation)) || annotation;
  const parentAnnotation = annotationsById.get(annotation.parent_annotation_id) || rootAnnotation;

  return {
    ...annotation,
    activity_at: annotation.created_at,
    is_reply: isReplyAnnotation(annotation),
    paperExists: Boolean(paper),
    paperPublished: paper?.published || "",
    paperSourceUrl: paper?.sourceUrl || "",
    paperTitle: paper?.title || "文献已删除",
    parent_note: isReplyAnnotation(annotation) ? parentAnnotation.note : "",
    parent_username: isReplyAnnotation(annotation) ? parentAnnotation.created_by_username || "" : "",
    speech_type: "annotation",
    thread_annotation_id: rootAnnotation.id,
    thread_id: rootAnnotation.id,
    thread_note: rootAnnotation.note,
  };
}

function serializeReplyNotification(annotation, papersById, annotationsById) {
  const baseRecord = serializeAnnotationActivity(annotation, papersById, annotationsById);

  return {
    ...baseRecord,
    reply_to_note: baseRecord.parent_note || "",
    reply_to_username: baseRecord.parent_username || "",
  };
}

function serializeDiscussionActivity(discussion, papersById, discussionsById) {
  const paper = papersById.get(discussion.paperId) || null;
  const rootDiscussion = discussionsById.get(getThreadRootDiscussionId(discussion)) || discussion;
  const parentDiscussion = discussionsById.get(discussion.parent_discussion_id) || rootDiscussion;

  return {
    ...discussion,
    activity_at: discussion.created_at,
    is_reply: isDiscussionReply(discussion),
    paperExists: Boolean(paper),
    paperPublished: paper?.published || "",
    paperSourceUrl: paper?.sourceUrl || "",
    paperTitle: paper?.title || "文献已删除",
    parent_note: isDiscussionReply(discussion) ? parentDiscussion.note : "",
    parent_username: isDiscussionReply(discussion)
      ? parentDiscussion.created_by_username || ""
      : "",
    speech_type: "discussion",
    thread_discussion_id: rootDiscussion.id,
    thread_id: rootDiscussion.id,
    thread_note: rootDiscussion.note,
  };
}

function serializeDiscussionReplyNotification(discussion, papersById, discussionsById) {
  const baseRecord = serializeDiscussionActivity(discussion, papersById, discussionsById);

  return {
    ...baseRecord,
    reply_to_note: baseRecord.parent_note || "",
    reply_to_username: baseRecord.parent_username || "",
  };
}

function compareRecordsByActivityDesc(fieldName) {
  return (left, right) => new Date(right?.[fieldName] || 0) - new Date(left?.[fieldName] || 0);
}

function compareUsersForDisplay(left, right) {
  const roleDifference = Number(getUserRole(right) === "admin") - Number(getUserRole(left) === "admin");

  if (roleDifference) {
    return roleDifference;
  }

  return String(left.username || "").localeCompare(String(right.username || ""), "zh-CN");
}

function normalizeText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

module.exports = {
  createDashboardService,
};
