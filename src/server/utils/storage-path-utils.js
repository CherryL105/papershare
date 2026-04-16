const path = require("path");

function createStoragePathUtils({ HttpError, pathModule = path, storageDir }) {
  function normalizeStorageRecordPath(storagePath) {
    const rawPath = String(storagePath || "")
      .trim()
      .replaceAll("\\", "/")
      .replace(/^\/+/, "")
      .replace(/^storage\//, "");

    if (!rawPath) {
      return "";
    }

    const segments = rawPath.split("/").filter(Boolean);

    if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
      throw new HttpError(400, "存储路径不合法");
    }

    return segments.join("/");
  }

  function resolveStorageAbsolutePath(storagePath) {
    return pathModule.join(storageDir, normalizeStorageRecordPath(storagePath));
  }

  function buildPrivateStorageUrl(storagePath) {
    return `/api/storage/${normalizeStorageRecordPath(storagePath)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }

  return {
    buildPrivateStorageUrl,
    normalizeStorageRecordPath,
    resolveStorageAbsolutePath,
  };
}

module.exports = {
  createStoragePathUtils,
};
