function createStaticRoutes(core) {
  return [
    {
      methods: ["GET", "HEAD"],
      pattern: "/",
      requiresAuth: false,
      handler: async ({ request, pathname, response }) => {
        await core.serveStaticAsset(request, pathname, response);
      },
    },
    {
      methods: ["GET", "HEAD"],
      pattern: "/:assetPath*",
      requiresAuth: false,
      handler: async ({ request, pathname, response }) => {
        await core.serveStaticAsset(request, pathname, response);
      },
    },
  ];
}

module.exports = {
  createStaticRoutes,
};
