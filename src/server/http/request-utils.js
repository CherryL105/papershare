function createHttpBodyHelpers({ maxRequestBodyBytes }) {
  async function readRequestJson(request) {
    const rawBody = (await readRequestBody(request)).toString("utf8");

    if (!rawBody) {
      return {};
    }

    try {
      return JSON.parse(rawBody);
    } catch (error) {
      throw new Error("请求体不是合法 JSON");
    }
  }

  function readRequestBody(request) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;

      request.on("data", (chunk) => {
        size += chunk.length;

        if (size > maxRequestBodyBytes) {
          reject(new Error("请求体过大"));
          request.destroy();
          return;
        }

        chunks.push(chunk);
      });

      request.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      request.on("error", reject);
    });
  }

  function sendJson(response, statusCode, payload, headers = {}) {
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    });
    response.end(JSON.stringify(payload));
  }

  return {
    readRequestBody,
    readRequestJson,
    sendJson,
  };
}

module.exports = {
  createHttpBodyHelpers,
};
