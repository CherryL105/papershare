function createStaticRoutes(services) {
  const { assets } = services;

  return [
    {
      methods: ["GET", "HEAD"],
      pattern: "/",
      requiresAuth: false,
      handler: async ({ request, pathname, response }) => {
        await assets.serveStaticAsset(request, pathname, response);
      },
    },
    {
      methods: ["GET", "HEAD"],
      pattern: "/:assetPath*",
      requiresAuth: false,
      handler: async ({ request, pathname, response }) => {
        await assets.serveStaticAsset(request, pathname, response);
      },
    },
  ];
}

module.exports = {
  createStaticRoutes,
};
