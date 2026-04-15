const { createApiRoutes } = require("./routes/api");
const { createStaticRoutes } = require("./routes/static");

function createRouter(core, routeDefinitions) {
  const routes = (
    Array.isArray(routeDefinitions) ? routeDefinitions : [...createApiRoutes(core), ...createStaticRoutes(core)]
  ).map(normalizeRouteDefinition);

  return async function dispatchRequest(request, response) {
    core.applyCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(
      request.url,
      `http://${request.headers.host || `127.0.0.1:${core.PORT}`}`
    );
    const pathname = requestUrl.pathname;
    const currentUser = await core.getCurrentUserFromRequest(request);

    for (const route of routes) {
      if (!route.methods.includes(request.method)) {
        continue;
      }

      const match = route.pattern.exec({ pathname });

      if (!match) {
        continue;
      }

      if (route.requiresAuth && !currentUser) {
        core.sendJson(response, 401, { error: "请先登录" });
        return;
      }

      await route.handler({
        core,
        currentUser,
        match,
        params: match.pathname?.groups || {},
        pathname,
        request,
        requestUrl,
        response,
      });
      return;
    }

    core.sendJson(response, 404, { error: "未找到请求资源" });
  };
}

function normalizeRouteDefinition(route) {
  return {
    ...route,
    methods: Array.isArray(route.methods) ? route.methods : [route.method],
    pattern:
      route.pattern instanceof URLPattern ? route.pattern : new URLPattern({ pathname: route.pattern }),
    requiresAuth: route.requiresAuth === true,
  };
}

module.exports = {
  createRouter,
};
