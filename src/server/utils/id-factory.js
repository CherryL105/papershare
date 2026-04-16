const crypto = require("crypto");

function createPaperId() {
  return createScopedId("paper");
}

function createAnnotationId() {
  return createScopedId("annotation");
}

function createDiscussionId() {
  return createScopedId("discussion");
}

function createAttachmentId() {
  return createScopedId("attachment");
}

function createScopedId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

module.exports = {
  createAnnotationId,
  createAttachmentId,
  createDiscussionId,
  createPaperId,
};
