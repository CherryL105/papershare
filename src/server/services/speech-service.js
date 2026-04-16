function createSpeechService(deps) {
  async function getAnnotationsByUserId(user) {
    if (deps.dashboardService?.getForUser) {
      const dashboard = await deps.dashboardService.getForUser(user);
      return dashboard.myAnnotations;
    }

    return deps.getAnnotationsByUserId(user);
  }

  return {
    clearAnnotationsByPaperId: deps.clearAnnotationsByPaperId,
    deleteAnnotationById: deps.deleteAnnotationById,
    deleteDiscussionById: deps.deleteDiscussionById,
    getAnnotationsByPaperId: deps.getAnnotationsByPaperId,
    getAnnotationsByUserId,
    getDiscussionsByPaperId: deps.getDiscussionsByPaperId,
    readMutationBody: deps.readSpeechMutationBody,
    saveAnnotation: deps.saveAnnotation,
    saveAnnotationReply: deps.saveAnnotationReply,
    saveDiscussion: deps.saveDiscussion,
    saveDiscussionReply: deps.saveDiscussionReply,
    updateAnnotationById: deps.updateAnnotationById,
    updateDiscussionById: deps.updateDiscussionById,
  };
}

module.exports = {
  createSpeechService,
};
