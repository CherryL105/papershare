const { createApiRoutes } = require("./routes/api");
const { createStaticRoutes } = require("./routes/static");

function createRouter(services, routeDefinitions) {
  const routes = (
    Array.isArray(routeDefinitions)
      ? routeDefinitions
      : [...createApiRoutes(services), ...createStaticRoutes(services)]
  ).map(normalizeRouteDefinition);
  const http = services.http;
  const auth = services.auth;
  const runtime = services.runtime || {};

  return async function dispatchRequest(request, response) {
    http.applyCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(
      request.url,
      `http://${request.headers.host || `127.0.0.1:${runtime.PORT || 3000}`}`
    );
    const pathname = requestUrl.pathname;
    const currentUser = await auth.getCurrentUserFromRequest(request);

    for (const route of routes) {
      if (!route.methods.includes(request.method)) {
        continue;
      }

      const match = route.pattern.exec({ pathname });

      if (!match) {
        continue;
      }

      if (route.requiresAuth && !currentUser) {
        http.sendJson(response, 401, { error: "请先登录" });
        return;
      }

      await route.handler({
        core: services,
        currentUser,
        match,
        params: match.pathname?.groups || {},
        pathname,
        request,
        requestUrl,
        response,
        services,
      });
      return;
    }

    http.sendJson(response, 404, { error: "未找到请求资源" });
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
