function createSpeechService(deps) {
  return {
    clearAnnotationsByPaperId: deps.clearAnnotationsByPaperId,
    deleteAnnotationById: deps.deleteAnnotationById,
    deleteDiscussionById: deps.deleteDiscussionById,
    getAnnotationsByPaperId: deps.getAnnotationsByPaperId,
    getAnnotationsByUserId: deps.getAnnotationsByUserId,
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
