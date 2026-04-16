function createCorsHelpers({ allowedOrigins }) {
  const normalizedAllowedOrigins =
    allowedOrigins instanceof Set ? allowedOrigins : new Set(allowedOrigins || []);

  function isAllowedCorsOrigin(request, origin) {
    if (!origin) {
      return false;
    }

    if (normalizedAllowedOrigins.has(origin)) {
      return true;
    }

    const host = String(request?.headers?.host || "").trim();

    if (!host) {
      return false;
    }

    return origin === `${isSecureRequest(request) ? "https" : "http"}://${host}`;
  }

  function applyCorsHeaders(request, response) {
    const origin = String(request.headers.origin || "").trim();

    if (!origin || !isAllowedCorsOrigin(request, origin)) {
      return;
    }

    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.setHeader("Vary", "Origin");
  }

  return {
    applyCorsHeaders,
    isAllowedCorsOrigin,
  };
}

function isSecureRequest(request) {
  const forwardedProto = String(request?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  return forwardedProto === "https" || Boolean(request?.socket?.encrypted);
}

module.exports = {
  createCorsHelpers,
  isSecureRequest,
};
