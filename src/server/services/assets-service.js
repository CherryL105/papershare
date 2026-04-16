function createAssetsService(deps) {
  return {
    fetchElsevierObject: deps.fetchElsevierObject,
    servePrivateStorageAsset: deps.servePrivateStorageAsset,
    serveStaticAsset: deps.serveStaticAsset,
  };
}

module.exports = {
  createAssetsService,
};
