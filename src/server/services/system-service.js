function createSystemService(deps) {
  async function getCollectionStats() {
    const [paperCount, annotationCount, discussionCount] = await Promise.all([
      deps.getJsonCollectionLength(deps.collectionFiles.papers),
      deps.getJsonCollectionLength(deps.collectionFiles.annotations),
      deps.getJsonCollectionLength(deps.collectionFiles.discussions),
    ]);

    return {
      paperCount,
      annotationCount,
      discussionCount,
    };
  }

  return {
    ensureStorageFiles: deps.ensureStorageFiles,
    getCollectionStats,
  };
}

module.exports = {
  createSystemService,
};
