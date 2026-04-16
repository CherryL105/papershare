function createAssetsService(deps) {
  const staticAssetCache = new Map();

  async function primeStaticAssetCache() {
    staticAssetCache.clear();

    try {
      await primeDirectory(deps.clientDistDir);
    } catch (error) {
      if (error?.code === "ENOENT") {
        console.warn(`Static asset cache skipped: dist directory not found at ${deps.clientDistDir}`);
        return {
          assetCount: 0,
          primed: false,
        };
      }

      console.warn(`Static asset cache skipped: ${error.message}`);
      staticAssetCache.clear();
      return {
        assetCount: 0,
        primed: false,
      };
    }

    return {
      assetCount: staticAssetCache.size,
      primed: true,
    };
  }

  async function serveStaticAsset(request, pathname, response) {
    let normalizedPath = "";

    try {
      normalizedPath = resolveStaticAssetPath(pathname, deps.path);
    } catch (error) {
      deps.sendJson(response, 404, { error: "Not found" });
      return;
    }

    if (isForbiddenStaticPath(normalizedPath)) {
      deps.sendJson(response, 403, { error: "Forbidden" });
      return;
    }

    const cachedAsset = staticAssetCache.get(normalizedPath);

    if (!cachedAsset) {
      deps.sendJson(response, 404, { error: "Not found" });
      return;
    }

    if (isRequestFresh(request, cachedAsset.etag, cachedAsset.lastModified)) {
      response.writeHead(304, {
        "Cache-Control": cachedAsset.cacheControl,
        ETag: cachedAsset.etag,
        "Last-Modified": cachedAsset.lastModified.toUTCString(),
      });
      response.end();
      return;
    }

    response.writeHead(200, {
      "Cache-Control": cachedAsset.cacheControl,
      "Content-Length": cachedAsset.size,
      "Content-Type": cachedAsset.contentType,
      ETag: cachedAsset.etag,
      "Last-Modified": cachedAsset.lastModified.toUTCString(),
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.end(cachedAsset.content);
  }

  async function servePrivateStorageAsset(storagePath, response) {
    const normalizedStoragePath = deps.normalizeStorageRecordPath(storagePath);

    if (!normalizedStoragePath.startsWith("attachments/")) {
      throw new deps.HttpError(404, "资源不存在");
    }

    const absolutePath = deps.resolveStorageAbsolutePath(normalizedStoragePath);

    if (!absolutePath.startsWith(deps.attachmentsDir)) {
      throw new deps.HttpError(403, "Forbidden");
    }

    try {
      const stat = await deps.fs.stat(absolutePath);

      if (!stat.isFile()) {
        throw new deps.HttpError(404, "资源不存在");
      }

      const fileExtension = deps.path.extname(absolutePath).toLowerCase();
      const contentType = deps.mimeTypeByExtension[fileExtension] || "application/octet-stream";
      const content = await deps.fs.readFile(absolutePath);
      response.writeHead(200, { "Content-Type": contentType, "Content-Length": content.length });
      response.end(content);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new deps.HttpError(404, "资源不存在");
      }

      throw error;
    }
  }

  async function primeDirectory(directoryPath) {
    const entries = await deps.fs.readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = deps.path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        await primeDirectory(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stat = await deps.fs.stat(absolutePath);
      const content = await deps.fs.readFile(absolutePath);
      const relativePath = deps.path.relative(deps.clientDistDir, absolutePath).replaceAll("\\", "/");
      const fileExtension = deps.path.extname(absolutePath).toLowerCase();

      staticAssetCache.set(relativePath, {
        cacheControl: resolveStaticCacheControl(relativePath, fileExtension, deps),
        content,
        contentType: deps.mimeTypeByExtension[fileExtension] || "application/octet-stream",
        etag: createWeakEtagFromStat(stat),
        lastModified: stat.mtime,
        size: stat.size,
      });
    }
  }

  return {
    fetchElsevierObject: deps.fetchElsevierObject,
    primeStaticAssetCache,
    servePrivateStorageAsset,
    serveStaticAsset,
  };
}

function resolveStaticAssetPath(pathname, pathModule) {
  const targetPath =
    pathname === "/"
      ? "/src/client/catalog/index.html"
      : pathname === "/paper.html"
        ? "/src/client/detail/paper.html"
        : pathname;
  const relativeTargetPath = decodeURIComponent(targetPath).replace(/^[/\\]+/, "");

  return pathModule.normalize(relativeTargetPath).replace(/^(\.\.[/\\])+/, "");
}

function isForbiddenStaticPath(normalizedPath) {
  const segments = String(normalizedPath || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean);
  const firstSegment = segments[0] || "";

  return [".git", ".local", "storage"].includes(firstSegment) || firstSegment.startsWith(".env");
}

function resolveStaticCacheControl(normalizedPath, fileExtension, deps) {
  if (fileExtension === ".html") {
    return deps.staticHtmlCacheControl;
  }

  return /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(deps.path.basename(normalizedPath))
    ? deps.staticHashedAssetCacheControl
    : deps.staticAssetCacheControl;
}

function createWeakEtagFromStat(stat) {
  return `W/"${Number(stat.size || 0).toString(16)}-${Math.floor(stat.mtimeMs || 0).toString(16)}"`;
}

function isRequestFresh(request, etag, lastModifiedDate) {
  const ifNoneMatchHeader = String(request?.headers?.["if-none-match"] || "").trim();

  if (ifNoneMatchHeader) {
    return ifNoneMatchHeader
      .split(",")
      .map((value) => value.trim())
      .includes(etag);
  }

  const ifModifiedSinceHeader = String(request?.headers?.["if-modified-since"] || "").trim();

  if (!ifModifiedSinceHeader) {
    return false;
  }

  const ifModifiedSince = new Date(ifModifiedSinceHeader).getTime();

  if (!Number.isFinite(ifModifiedSince)) {
    return false;
  }

  return Math.floor(new Date(lastModifiedDate).getTime() / 1000) <= Math.floor(ifModifiedSince / 1000);
}

module.exports = {
  createAssetsService,
};
