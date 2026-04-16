function createHttpService(deps) {
  async function readPaperRequest(request) {
    const body = await deps.readRequestJson(request);

    return {
      body,
      elsevierApiKey: readTrimmedTextField(body, "elsevierApiKey"),
      sourceUrl: readRequiredTrimmedTextField(body, "sourceUrl", "缺少 sourceUrl"),
    };
  }

  async function readPaperHtmlImportRequest(request) {
    const body = await deps.readRequestJson(request);

    return {
      body,
      elsevierApiKey: readTrimmedTextField(body, "elsevierApiKey"),
      rawHtml: readRequiredTextField(body, "rawHtml", "缺少 rawHtml"),
      sourceUrl: readRequiredTrimmedTextField(body, "sourceUrl", "缺少 sourceUrl"),
    };
  }

  function sendError(response, error, fallbackMessage, fallbackStatusCode = 400) {
    deps.sendJson(response, Number.isInteger(error?.statusCode) ? error.statusCode : fallbackStatusCode, {
      error: error?.message || fallbackMessage,
    });
  }

  return {
    applyCorsHeaders: deps.applyCorsHeaders,
    getSessionTokenFromRequest: deps.getSessionTokenFromRequest,
    readJson: deps.readRequestJson,
    readPaperHtmlImportRequest,
    readPaperRequest,
    readSpeechMutation: deps.readSpeechMutationBody,
    sendError,
    sendJson: deps.sendJson,
    serializeExpiredSessionCookie: deps.serializeExpiredSessionCookie,
    serializeSessionCookie: deps.serializeSessionCookie,
  };
}

function readTrimmedTextField(body, fieldName) {
  return normalizeText(body?.[fieldName]);
}

function readRequiredTrimmedTextField(body, fieldName, errorMessage) {
  const value = readTrimmedTextField(body, fieldName);

  if (!value) {
    throw new Error(errorMessage);
  }

  return value;
}

function readRequiredTextField(body, fieldName, errorMessage) {
  const value = body?.[fieldName] === undefined || body?.[fieldName] === null ? "" : String(body[fieldName]);

  if (!value.trim()) {
    throw new Error(errorMessage);
  }

  return value;
}

function normalizeText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

module.exports = {
  createHttpService,
};
