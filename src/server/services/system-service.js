function createSystemService(deps) {
  async function ensureRuntimeReady(defaultUsers) {
    await deps.fs.mkdir(deps.storageDir, { recursive: true });
    await deps.fs.mkdir(deps.htmlDir, { recursive: true });
    await deps.fs.mkdir(deps.attachmentsDir, { recursive: true });
    const storeState = await deps.store.ensureReady();

    await deps.usersService.ensureDefaultUsers(defaultUsers);
    logOwnershipBackfillResult(deps.store.backfillOwnership());

    if (storeState.addedSpeechCountColumn || storeState.migratedLegacyJson) {
      deps.store.runInTransaction((repositories) => {
        repositories.papers.backfillActivityFields();
      });
    }

    await deps.assetsService.primeStaticAssetCache();
    return storeState;
  }

  async function getCollectionStats() {
    const [paperCount, annotationCount, discussionCount] = await Promise.all([
      deps.store.getCollectionLength(deps.collectionFiles.papers),
      deps.store.getCollectionLength(deps.collectionFiles.annotations),
      deps.store.getCollectionLength(deps.collectionFiles.discussions),
    ]);

    return {
      paperCount,
      annotationCount,
      discussionCount,
    };
  }

  return {
    ensureRuntimeReady,
    getCollectionStats,
  };
}

function logOwnershipBackfillResult(result) {
  const updatedSummaries = Object.entries(result || {}).filter(
    ([, stats]) => Number(stats?.updatedCount || 0) > 0
  );

  if (updatedSummaries.length) {
    console.log(
      `Backfilled record ownership: ${updatedSummaries
        .map(([tableName, stats]) => `${tableName}=${Number(stats.updatedCount || 0)}`)
        .join(", ")}`
    );
  }

  Object.entries(result || {}).forEach(([tableName, stats]) => {
    if (!Number(stats?.unmatchedCount || 0)) {
      return;
    }

    const usernames = (Array.isArray(stats.unmatchedUsernames) ? stats.unmatchedUsernames : [])
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");

    console.warn(
      `Ownership backfill skipped ${Number(stats.unmatchedCount || 0)} ${tableName} record(s) with unknown usernames${usernames ? `: ${usernames}` : ""}`
    );
  });
}

module.exports = {
  createSystemService,
};
