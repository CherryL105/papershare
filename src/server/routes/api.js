function createApiRoutes(core) {
  return [
    {
      method: "POST",
      pattern: "/api/auth/login",
      requiresAuth: false,
      handler: async ({ request, response }) => {
        try {
          const body = await core.readRequestJson(request);
          const session = await core.loginUser(body);

          core.sendJson(
            response,
            200,
            {
              ok: true,
              token: session.token,
              user: session.user,
            },
            {
              "Set-Cookie": core.serializeSessionCookie(request, session.token),
            }
          );
        } catch (error) {
          core.sendJson(response, 401, { error: error.message || "登录失败" });
        }
      },
    },
    {
      method: "GET",
      pattern: "/api/auth/me",
      requiresAuth: false,
      handler: async ({ currentUser, response }) => {
        core.sendJson(response, 200, {
          authenticated: Boolean(currentUser),
          user: currentUser ? core.serializeUser(currentUser) : null,
        });
      },
    },
    {
      method: "POST",
      pattern: "/api/auth/logout",
      requiresAuth: false,
      handler: async ({ request, response }) => {
        const sessionToken = core.getSessionTokenFromRequest(request);

        if (sessionToken) {
          await core.deleteSession(sessionToken);
        }

        core.sendJson(
            response,
            200,
            { ok: true },
            {
              "Set-Cookie": core.serializeExpiredSessionCookie(request),
            }
          );
      },
    },
    {
      methods: ["GET", "HEAD"],
      pattern: "/api/elsevier/object",
      requiresAuth: false,
      handler: async ({ request, requestUrl, response }) => {
        const eid = String(requestUrl.searchParams.get("eid") || "").trim();
        const mimeType = core.normalizeMimeType(requestUrl.searchParams.get("mimeType") || "");
        const { contentType, content } = await core.fetchElsevierObjectBinary(eid, mimeType);

        response.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": content.length,
          "Cache-Control": "private, max-age=86400",
        });

        if (request.method === "HEAD") {
          response.end();
          return;
        }

        response.end(content);
      },
    },
    {
      method: "GET",
      pattern: "/api/storage/:storagePath*",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        await core.servePrivateStorageAsset(decodeURIComponent(params.storagePath || ""), response);
      },
    },
    {
      method: "GET",
      pattern: "/api/me/annotations",
      requiresAuth: true,
      handler: async ({ currentUser, response }) => {
        const annotations = await core.getAnnotationsByUserId(currentUser);
        core.sendJson(response, 200, annotations);
      },
    },
    {
      method: "GET",
      pattern: "/api/me/dashboard",
      requiresAuth: true,
      handler: async ({ currentUser, response }) => {
        const dashboard = await core.getUserDashboard(currentUser);
        core.sendJson(response, 200, dashboard);
      },
    },
    {
      method: "POST",
      pattern: "/api/me/password",
      requiresAuth: true,
      handler: async ({ currentUser, request, response }) => {
        try {
          const body = await core.readRequestJson(request);
          await core.changeUserPassword(currentUser.id, body);
          core.sendJson(response, 200, { ok: true });
        } catch (error) {
          core.sendJson(response, error.statusCode || 400, { error: error.message || "修改密码失败" });
        }
      },
    },
    {
      method: "POST",
      pattern: "/api/me/username",
      requiresAuth: true,
      handler: async ({ currentUser, request, response }) => {
        try {
          const body = await core.readRequestJson(request);
          const user = await core.changeUsername(currentUser.id, body);
          core.sendJson(response, 200, { ok: true, user });
        } catch (error) {
          core.sendJson(response, error.statusCode || 400, { error: error.message || "修改用户名失败" });
        }
      },
    },
    {
      method: "POST",
      pattern: "/api/users",
      requiresAuth: true,
      handler: async ({ currentUser, request, response }) => {
        try {
          core.assertAdminUser(currentUser);
          const body = await core.readRequestJson(request);
          const user = await core.createMemberUser(body);
          core.sendJson(response, 201, { ok: true, user });
        } catch (error) {
          core.sendJson(response, error.statusCode || 400, { error: error.message || "创建用户失败" });
        }
      },
    },
    {
      method: "POST",
      pattern: "/api/users/:userId/transfer-admin",
      requiresAuth: true,
      handler: async ({ currentUser, params, response }) => {
        try {
          core.assertAdminUser(currentUser);
          const targetUserId = decodeURIComponent(params.userId || "");
          const result = await core.transferAdminRole(currentUser.id, targetUserId);
          core.sendJson(response, 200, {
            ok: true,
            currentUser: result.currentUser,
            targetUser: result.targetUser,
          });
        } catch (error) {
          core.sendJson(response, error.statusCode || 400, { error: error.message || "转让管理员失败" });
        }
      },
    },
    {
      method: "GET",
      pattern: "/api/users",
      requiresAuth: true,
      handler: async ({ response }) => {
        const users = await core.listUsersWithStats();
        core.sendJson(response, 200, users);
      },
    },
    {
      method: "DELETE",
      pattern: "/api/users/:userId",
      requiresAuth: true,
      handler: async ({ currentUser, params, requestUrl, response }) => {
        try {
          core.assertAdminUser(currentUser);
          const userId = decodeURIComponent(params.userId || "");
          const purgeContent = requestUrl.searchParams.get("purgeContent") === "1";
          const result = await core.deleteUserById(currentUser.id, userId, { purgeContent });
          core.sendJson(response, 200, { ok: true, ...result });
        } catch (error) {
          core.sendJson(response, error.statusCode || 400, { error: error.message || "删除用户失败" });
        }
      },
    },
    {
      method: "GET",
      pattern: "/api/users/:userId/profile",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        const userId = decodeURIComponent(params.userId || "");
        const profile = await core.getPublicUserProfile(userId);
        core.sendJson(response, 200, profile);
      },
    },
    {
      method: "GET",
      pattern: "/api/status",
      requiresAuth: true,
      handler: async ({ response }) => {
        const [paperCount, annotationCount, discussionCount] = await Promise.all([
          core.getJsonCollectionLength(core.PAPERS_FILE),
          core.getJsonCollectionLength(core.ANNOTATIONS_FILE),
          core.getJsonCollectionLength(core.DISCUSSIONS_FILE),
        ]);
        core.sendJson(response, 200, {
          ok: true,
          paperCount,
          annotationCount,
          discussionCount,
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/papers",
      requiresAuth: true,
      handler: async ({ response }) => {
        const papers = await core.listPapersWithActivity();
        core.sendJson(response, 200, papers);
      },
    },
    {
      method: "POST",
      pattern: "/api/papers",
      requiresAuth: true,
      handler: async ({ currentUser, request, response }) => {
        const body = await core.readRequestJson(request);
        const sourceUrl = String(body.sourceUrl || "").trim();
        const elsevierApiKey = String(body.elsevierApiKey || "").trim();

        if (!sourceUrl) {
          core.sendJson(response, 400, { error: "缺少 sourceUrl" });
          return;
        }

        const paper = await core.fetchAndStorePaper(sourceUrl, currentUser, { elsevierApiKey });
        core.sendJson(response, 201, paper);
      },
    },
    {
      method: "POST",
      pattern: "/api/papers/import-html",
      requiresAuth: true,
      handler: async ({ currentUser, request, response }) => {
        const body = await core.readRequestJson(request);
        const sourceUrl = String(body.sourceUrl || "").trim();
        const rawHtml = String(body.rawHtml || "");
        const elsevierApiKey = String(body.elsevierApiKey || "").trim();

        if (!sourceUrl) {
          core.sendJson(response, 400, { error: "缺少 sourceUrl" });
          return;
        }

        if (!rawHtml.trim()) {
          core.sendJson(response, 400, { error: "缺少 rawHtml" });
          return;
        }

        const paper = await core.importPaperFromHtml(sourceUrl, rawHtml, currentUser, {
          elsevierApiKey,
        });
        core.sendJson(response, 201, paper);
      },
    },
    {
      method: "GET",
      pattern: "/api/papers/:paperId/content",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await core.getPaperById(paperId);

        if (!paper) {
          core.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        if (!paper.snapshotPath) {
          core.sendJson(response, 404, { error: "当前文献没有网页快照" });
          return;
        }

        const snapshotPath = core.path.join(core.STORAGE_DIR, paper.snapshotPath);
        const rawHtml = await core.fs.readFile(snapshotPath, "utf8");
        core.sendJson(response, 200, {
          rawHtml: core.enforceSnapshotArticleImagePolicy(rawHtml, paper.sourceUrl),
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/papers/:paperId/annotations",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await core.getPaperById(paperId);

        if (!paper) {
          core.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        const annotations = await core.getAnnotationsByPaperId(paperId);
        core.sendJson(response, 200, annotations);
      },
    },
    {
      method: "POST",
      pattern: "/api/papers/:paperId/annotations",
      requiresAuth: true,
      handler: async ({ currentUser, params, request, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await core.getPaperById(paperId);

        if (!paper) {
          core.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        const body = await core.readSpeechMutationBody(request);
        const annotation = await core.saveAnnotation(paperId, body, currentUser);
        core.sendJson(response, 201, annotation);
      },
    },
    {
      method: "DELETE",
      pattern: "/api/papers/:paperId/annotations",
      requiresAuth: true,
      handler: async ({ currentUser, params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await core.getPaperById(paperId);

        if (!paper) {
          core.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        const deletedCount = await core.clearAnnotationsByPaperId(paperId, currentUser);
        core.sendJson(response, 200, { ok: true, deletedCount });
      },
    },
    {
      method: "GET",
      pattern: "/api/papers/:paperId/discussions",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await core.getPaperById(paperId);

        if (!paper) {
          core.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        const discussions = await core.getDiscussionsByPaperId(paperId);
        core.sendJson(response, 200, discussions);
      },
    },
    {
      method: "POST",
      pattern: "/api/papers/:paperId/discussions",
      requiresAuth: true,
      handler: async ({ currentUser, params, request, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await core.getPaperById(paperId);

        if (!paper) {
          core.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        const body = await core.readSpeechMutationBody(request);
        const discussion = await core.saveDiscussion(paperId, body, currentUser);
        core.sendJson(response, 201, discussion);
      },
    },
    {
      method: "GET",
      pattern: "/api/papers/:paperId",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await core.getPaperById(paperId);

        if (!paper) {
          core.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        core.sendJson(response, 200, paper);
      },
    },
    {
      method: "DELETE",
      pattern: "/api/papers/:paperId",
      requiresAuth: true,
      handler: async ({ currentUser, params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const result = await core.deletePaperById(paperId, currentUser);
        core.sendJson(response, 200, result);
      },
    },
    {
      method: "POST",
      pattern: "/api/annotations/:annotationId/replies",
      requiresAuth: true,
      handler: async ({ currentUser, params, request, response }) => {
        try {
          const annotationId = decodeURIComponent(params.annotationId || "");
          const body = await core.readSpeechMutationBody(request);
          const reply = await core.saveAnnotationReply(annotationId, body, currentUser);
          core.sendJson(response, 201, reply);
        } catch (error) {
          const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
          core.sendJson(response, statusCode, { error: error.message || "回复批注失败" });
        }
      },
    },
    {
      method: "PATCH",
      pattern: "/api/annotations/:annotationId",
      requiresAuth: true,
      handler: async ({ currentUser, params, request, response }) => {
        try {
          const annotationId = decodeURIComponent(params.annotationId || "");
          const body = await core.readSpeechMutationBody(request);
          const annotation = await core.updateAnnotationById(annotationId, body, currentUser);
          core.sendJson(response, 200, annotation);
        } catch (error) {
          const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
          core.sendJson(response, statusCode, { error: error.message || "编辑批注失败" });
        }
      },
    },
    {
      method: "DELETE",
      pattern: "/api/annotations/:annotationId",
      requiresAuth: true,
      handler: async ({ currentUser, params, response }) => {
        const annotationId = decodeURIComponent(params.annotationId || "");
        const result = await core.deleteAnnotationById(annotationId, currentUser);
        core.sendJson(response, 200, result);
      },
    },
    {
      method: "POST",
      pattern: "/api/discussions/:discussionId/replies",
      requiresAuth: true,
      handler: async ({ currentUser, params, request, response }) => {
        try {
          const discussionId = decodeURIComponent(params.discussionId || "");
          const body = await core.readSpeechMutationBody(request);
          const reply = await core.saveDiscussionReply(discussionId, body, currentUser);
          core.sendJson(response, 201, reply);
        } catch (error) {
          const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
          core.sendJson(response, statusCode, { error: error.message || "回复讨论失败" });
        }
      },
    },
    {
      method: "PATCH",
      pattern: "/api/discussions/:discussionId",
      requiresAuth: true,
      handler: async ({ currentUser, params, request, response }) => {
        try {
          const discussionId = decodeURIComponent(params.discussionId || "");
          const body = await core.readSpeechMutationBody(request);
          const discussion = await core.updateDiscussionById(discussionId, body, currentUser);
          core.sendJson(response, 200, discussion);
        } catch (error) {
          const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
          core.sendJson(response, statusCode, { error: error.message || "编辑讨论失败" });
        }
      },
    },
    {
      method: "DELETE",
      pattern: "/api/discussions/:discussionId",
      requiresAuth: true,
      handler: async ({ currentUser, params, response }) => {
        const discussionId = decodeURIComponent(params.discussionId || "");
        const result = await core.deleteDiscussionById(discussionId, currentUser);
        core.sendJson(response, 200, result);
      },
    },
  ];
}

module.exports = {
  createApiRoutes,
};
