function createApiRoutes(services) {
  const { assets, auth, dashboard, http, papers, speech, system, users } = services;

  return [
    {
      method: "POST",
      pattern: "/api/auth/login",
      requiresAuth: false,
      handler: async ({ request, response }) => {
        try {
          const body = await http.readJson(request);
          const session = await auth.login(body);

          http.sendJson(
            response,
            200,
            {
              ok: true,
              token: session.token,
              user: session.user,
            },
            {
              "Set-Cookie": http.serializeSessionCookie(request, session.token),
            }
          );
        } catch (error) {
          http.sendJson(response, 401, { error: error.message || "登录失败" });
        }
      },
    },
    {
      method: "GET",
      pattern: "/api/auth/me",
      requiresAuth: false,
      handler: async ({ currentUser, response }) => {
        http.sendJson(response, 200, {
          authenticated: Boolean(currentUser),
          user: currentUser ? auth.serializeUser(currentUser) : null,
        });
      },
    },
    {
      method: "POST",
      pattern: "/api/auth/logout",
      requiresAuth: false,
      handler: async ({ request, response }) => {
        const sessionToken = http.getSessionTokenFromRequest(request);

        if (sessionToken) {
          await auth.deleteSession(sessionToken);
        }

        http.sendJson(
          response,
          200,
          { ok: true },
          {
            "Set-Cookie": http.serializeExpiredSessionCookie(request),
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
        const mimeType = requestUrl.searchParams.get("mimeType") || "";
        const { contentType, content } = await assets.fetchElsevierObject(eid, mimeType);

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
        await assets.servePrivateStorageAsset(decodeURIComponent(params.storagePath || ""), response);
      },
    },
    {
      method: "GET",
      pattern: "/api/me/annotations",
      requiresAuth: true,
      handler: async ({ currentUser, response }) => {
        const annotations = await speech.getAnnotationsByUserId(currentUser);
        http.sendJson(response, 200, annotations);
      },
    },
    {
      method: "GET",
      pattern: "/api/me/dashboard",
      requiresAuth: true,
      handler: async ({ currentUser, response }) => {
        const userDashboard = await dashboard.getForUser(currentUser);
        http.sendJson(response, 200, userDashboard);
      },
    },
    {
      method: "POST",
      pattern: "/api/me/password",
      requiresAuth: true,
      handler: async ({ currentUser, request, response }) => {
        try {
          const body = await http.readJson(request);
          await users.changePassword(currentUser.id, body);
          http.sendJson(response, 200, { ok: true });
        } catch (error) {
          http.sendJson(response, error.statusCode || 400, {
            error: error.message || "修改密码失败",
          });
        }
      },
    },
    {
      method: "POST",
      pattern: "/api/me/username",
      requiresAuth: true,
      handler: async ({ currentUser, request, response }) => {
        try {
          const body = await http.readJson(request);
          const user = await users.changeUsername(currentUser.id, body);
          http.sendJson(response, 200, { ok: true, user });
        } catch (error) {
          http.sendJson(response, error.statusCode || 400, {
            error: error.message || "修改用户名失败",
          });
        }
      },
    },
    {
      method: "POST",
      pattern: "/api/users",
      requiresAuth: true,
      handler: async ({ currentUser, request, response }) => {
        try {
          users.assertAdmin(currentUser);
          const body = await http.readJson(request);
          const user = await users.createMemberUser(body);
          http.sendJson(response, 201, { ok: true, user });
        } catch (error) {
          http.sendJson(response, error.statusCode || 400, { error: error.message || "创建用户失败" });
        }
      },
    },
    {
      method: "POST",
      pattern: "/api/users/:userId/transfer-admin",
      requiresAuth: true,
      handler: async ({ currentUser, params, response }) => {
        try {
          users.assertAdmin(currentUser);
          const targetUserId = decodeURIComponent(params.userId || "");
          const result = await users.transferAdminRole(currentUser.id, targetUserId);
          http.sendJson(response, 200, {
            ok: true,
            currentUser: result.currentUser,
            targetUser: result.targetUser,
          });
        } catch (error) {
          http.sendJson(response, error.statusCode || 400, {
            error: error.message || "转让管理员失败",
          });
        }
      },
    },
    {
      method: "GET",
      pattern: "/api/users",
      requiresAuth: true,
      handler: async ({ response }) => {
        const allUsers = await dashboard.listUsersWithStats();
        http.sendJson(response, 200, allUsers);
      },
    },
    {
      method: "DELETE",
      pattern: "/api/users/:userId",
      requiresAuth: true,
      handler: async ({ currentUser, params, requestUrl, response }) => {
        try {
          users.assertAdmin(currentUser);
          const userId = decodeURIComponent(params.userId || "");
          const purgeContent = requestUrl.searchParams.get("purgeContent") === "1";
          const result = await users.deleteById(currentUser.id, userId, { purgeContent });
          http.sendJson(response, 200, { ok: true, ...result });
        } catch (error) {
          http.sendJson(response, error.statusCode || 400, { error: error.message || "删除用户失败" });
        }
      },
    },
    {
      method: "GET",
      pattern: "/api/users/:userId/profile",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        const userId = decodeURIComponent(params.userId || "");
        const profile = await dashboard.getPublicUserProfile(userId);
        http.sendJson(response, 200, profile);
      },
    },
    {
      method: "GET",
      pattern: "/api/status",
      requiresAuth: true,
      handler: async ({ response }) => {
        const stats = await system.getCollectionStats();
        http.sendJson(response, 200, {
          ok: true,
          ...stats,
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/papers",
      requiresAuth: true,
      handler: async ({ response }) => {
        const allPapers = await papers.listWithActivity();
        http.sendJson(response, 200, allPapers);
      },
    },
    {
      method: "POST",
      pattern: "/api/papers",
      requiresAuth: true,
      handler: async ({ currentUser, request, response }) => {
        const body = await http.readJson(request);
        const sourceUrl = String(body.sourceUrl || "").trim();
        const elsevierApiKey = String(body.elsevierApiKey || "").trim();

        if (!sourceUrl) {
          http.sendJson(response, 400, { error: "缺少 sourceUrl" });
          return;
        }

        const paper = await papers.fetchAndStore(sourceUrl, currentUser, { elsevierApiKey });
        http.sendJson(response, 201, paper);
      },
    },
    {
      method: "POST",
      pattern: "/api/papers/import-html",
      requiresAuth: true,
      handler: async ({ currentUser, request, response }) => {
        const body = await http.readJson(request);
        const sourceUrl = String(body.sourceUrl || "").trim();
        const rawHtml = String(body.rawHtml || "");
        const elsevierApiKey = String(body.elsevierApiKey || "").trim();

        if (!sourceUrl) {
          http.sendJson(response, 400, { error: "缺少 sourceUrl" });
          return;
        }

        if (!rawHtml.trim()) {
          http.sendJson(response, 400, { error: "缺少 rawHtml" });
          return;
        }

        const paper = await papers.importFromHtml(sourceUrl, rawHtml, currentUser, {
          elsevierApiKey,
        });
        http.sendJson(response, 201, paper);
      },
    },
    {
      method: "GET",
      pattern: "/api/papers/:paperId/content",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const snapshot = await papers.readSnapshotContent(paperId);
        http.sendJson(response, 200, snapshot);
      },
    },
    {
      method: "GET",
      pattern: "/api/papers/:paperId/annotations",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await papers.getById(paperId);

        if (!paper) {
          http.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        const annotations = await speech.getAnnotationsByPaperId(paperId);
        http.sendJson(response, 200, annotations);
      },
    },
    {
      method: "POST",
      pattern: "/api/papers/:paperId/annotations",
      requiresAuth: true,
      handler: async ({ currentUser, params, request, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await papers.getById(paperId);

        if (!paper) {
          http.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        const body = await speech.readMutationBody(request);
        const annotation = await speech.saveAnnotation(paperId, body, currentUser);
        http.sendJson(response, 201, annotation);
      },
    },
    {
      method: "DELETE",
      pattern: "/api/papers/:paperId/annotations",
      requiresAuth: true,
      handler: async ({ currentUser, params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await papers.getById(paperId);

        if (!paper) {
          http.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        const deletedCount = await speech.clearAnnotationsByPaperId(paperId, currentUser);
        http.sendJson(response, 200, { ok: true, deletedCount });
      },
    },
    {
      method: "GET",
      pattern: "/api/papers/:paperId/discussions",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await papers.getById(paperId);

        if (!paper) {
          http.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        const discussions = await speech.getDiscussionsByPaperId(paperId);
        http.sendJson(response, 200, discussions);
      },
    },
    {
      method: "POST",
      pattern: "/api/papers/:paperId/discussions",
      requiresAuth: true,
      handler: async ({ currentUser, params, request, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await papers.getById(paperId);

        if (!paper) {
          http.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        const body = await speech.readMutationBody(request);
        const discussion = await speech.saveDiscussion(paperId, body, currentUser);
        http.sendJson(response, 201, discussion);
      },
    },
    {
      method: "GET",
      pattern: "/api/papers/:paperId",
      requiresAuth: true,
      handler: async ({ params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const paper = await papers.getById(paperId);

        if (!paper) {
          http.sendJson(response, 404, { error: "文献不存在" });
          return;
        }

        http.sendJson(response, 200, paper);
      },
    },
    {
      method: "DELETE",
      pattern: "/api/papers/:paperId",
      requiresAuth: true,
      handler: async ({ currentUser, params, response }) => {
        const paperId = decodeURIComponent(params.paperId || "");
        const result = await papers.deleteById(paperId, currentUser);
        http.sendJson(response, 200, result);
      },
    },
    {
      method: "POST",
      pattern: "/api/annotations/:annotationId/replies",
      requiresAuth: true,
      handler: async ({ currentUser, params, request, response }) => {
        try {
          const annotationId = decodeURIComponent(params.annotationId || "");
          const body = await speech.readMutationBody(request);
          const reply = await speech.saveAnnotationReply(annotationId, body, currentUser);
          http.sendJson(response, 201, reply);
        } catch (error) {
          const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
          http.sendJson(response, statusCode, { error: error.message || "回复批注失败" });
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
          const body = await speech.readMutationBody(request);
          const annotation = await speech.updateAnnotationById(annotationId, body, currentUser);
          http.sendJson(response, 200, annotation);
        } catch (error) {
          const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
          http.sendJson(response, statusCode, { error: error.message || "编辑批注失败" });
        }
      },
    },
    {
      method: "DELETE",
      pattern: "/api/annotations/:annotationId",
      requiresAuth: true,
      handler: async ({ currentUser, params, response }) => {
        const annotationId = decodeURIComponent(params.annotationId || "");
        const result = await speech.deleteAnnotationById(annotationId, currentUser);
        http.sendJson(response, 200, result);
      },
    },
    {
      method: "POST",
      pattern: "/api/discussions/:discussionId/replies",
      requiresAuth: true,
      handler: async ({ currentUser, params, request, response }) => {
        try {
          const discussionId = decodeURIComponent(params.discussionId || "");
          const body = await speech.readMutationBody(request);
          const reply = await speech.saveDiscussionReply(discussionId, body, currentUser);
          http.sendJson(response, 201, reply);
        } catch (error) {
          const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
          http.sendJson(response, statusCode, { error: error.message || "回复讨论失败" });
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
          const body = await speech.readMutationBody(request);
          const discussion = await speech.updateDiscussionById(discussionId, body, currentUser);
          http.sendJson(response, 200, discussion);
        } catch (error) {
          const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
          http.sendJson(response, statusCode, { error: error.message || "编辑讨论失败" });
        }
      },
    },
    {
      method: "DELETE",
      pattern: "/api/discussions/:discussionId",
      requiresAuth: true,
      handler: async ({ currentUser, params, response }) => {
        const discussionId = decodeURIComponent(params.discussionId || "");
        const result = await speech.deleteDiscussionById(discussionId, currentUser);
        http.sendJson(response, 200, result);
      },
    },
  ];
}

module.exports = {
  createApiRoutes,
};
