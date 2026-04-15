function createAssetsService(deps) {
  async function fetchElsevierObject(eid, mimeType) {
    return deps.fetchElsevierObjectBinary(eid, deps.normalizeMimeType(mimeType || ""));
  }

  return {
    fetchElsevierObject,
    servePrivateStorageAsset: deps.servePrivateStorageAsset,
    serveStaticAsset: deps.serveStaticAsset,
  };
}

module.exports = {
  createAssetsService,
};
