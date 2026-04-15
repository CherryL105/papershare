function createPapersService(deps) {
  async function readSnapshotContent(paperId) {
    const paper = await deps.getPaperById(paperId);

    if (!paper) {
      throw new deps.HttpError(404, "文献不存在");
    }

    if (!paper.snapshotPath) {
      throw new deps.HttpError(404, "当前文献没有网页快照");
    }

    const snapshotPath = deps.path.join(deps.storageDir, paper.snapshotPath);
    const rawHtml = await deps.fs.readFile(snapshotPath, "utf8");

    return {
      rawHtml: deps.enforceSnapshotArticleImagePolicy(rawHtml, paper.sourceUrl),
    };
  }

  return {
    deleteById: deps.deletePaperById,
    fetchAndStore: deps.fetchAndStorePaper,
    getById: deps.getPaperById,
    importFromHtml: deps.importPaperFromHtml,
    listWithActivity: deps.listPapersWithActivity,
    readSnapshotContent,
  };
}

module.exports = {
  createPapersService,
};
