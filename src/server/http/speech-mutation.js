const Busboy = require("busboy");
const { normalizeMimeType } = require("../../../shared/papershare-shared");

function createSpeechMutationReader({
  formatLimitInMb,
  maxAttachmentBytes,
  maxAttachmentCount,
  maxRequestBodyBytes,
  normalizeAttachmentRecord,
  readRequestJson,
  sanitizeAttachmentName,
}) {
  async function readSpeechMutationBody(request) {
    const contentType = String(request.headers["content-type"] || "");

    if (contentType.toLowerCase().includes("multipart/form-data")) {
      return readMultipartSpeechBody(request, contentType);
    }

    return readRequestJson(request);
  }

  async function readMultipartSpeechBody(request, contentType) {
    const { fields, files } = await streamMultipartFormData(request, contentType);
    const retainedAttachments = parseMultipartJsonField(
      fields.retainedAttachments,
      "保留附件格式不合法"
    );

    return {
      ...fields,
      attachments: [
        ...normalizeRetainedAttachments(retainedAttachments),
        ...files.map(createMultipartAttachmentDraft),
      ],
    };
  }

  function streamMultipartFormData(request, contentType) {
    return new Promise((resolve, reject) => {
      let parser;

      try {
        parser = Busboy({
          headers: {
            ...request.headers,
            "content-type": contentType,
          },
          limits: {
            files: maxAttachmentCount,
            fileSize: maxAttachmentBytes,
          },
        });
      } catch (error) {
        reject(new Error("multipart 请求缺少 boundary"));
        return;
      }

      const fields = {};
      const files = [];
      let totalBytes = 0;
      let settled = false;

      function cleanup() {
        request.off("data", handleChunk);
        request.off("error", handleRequestError);
        parser.removeAllListeners();
      }

      function fail(error) {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        request.unpipe(parser);
        request.resume();
        reject(error);
      }

      function handleChunk(chunk) {
        totalBytes += chunk.length;

        if (totalBytes > maxRequestBodyBytes) {
          fail(new Error("请求体过大"));
          request.destroy();
        }
      }

      function handleRequestError(error) {
        fail(error);
      }

      parser.on("field", (name, value) => {
        if (name) {
          fields[name] = value;
        }
      });

      parser.on("file", (name, stream, info) => {
        const chunks = [];
        let fileSize = 0;
        const filename = String(info?.filename || "").trim();
        const mimeType = String(info?.mimeType || "").trim();

        stream.on("data", (chunk) => {
          fileSize += chunk.length;
          chunks.push(chunk);
        });

        stream.on("limit", () => {
          fail(
            new Error(
              `附件“${sanitizeAttachmentName(filename || "未命名附件")}”超过 ${formatLimitInMb(maxAttachmentBytes)} MB 限制`
            )
          );
        });

        stream.on("error", (error) => {
          fail(error);
        });

        stream.on("end", () => {
          if (settled || !filename) {
            return;
          }

          files.push({
            contentType: mimeType,
            data: Buffer.concat(chunks, fileSize),
            filename,
            name,
          });
        });
      });

      parser.on("filesLimit", () => {
        fail(new Error(`单次最多上传 ${maxAttachmentCount} 个附件`));
      });

      parser.on("error", (error) => {
        fail(error);
      });

      parser.on("finish", () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve({ fields, files });
      });

      request.on("data", handleChunk);
      request.on("error", handleRequestError);
      request.pipe(parser);
    });
  }

  function parseMultipartJsonField(rawValue, errorMessage) {
    const value = String(rawValue || "").trim();

    if (!value) {
      return [];
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(errorMessage);
    }
  }

  function normalizeRetainedAttachments(attachments) {
    if (!Array.isArray(attachments)) {
      throw new Error("保留附件格式不合法");
    }

    return attachments.map((attachment) => normalizeAttachmentRecord(attachment));
  }

  function createMultipartAttachmentDraft(filePart) {
    return {
      name: sanitizeAttachmentName(filePart.filename || ""),
      mimeType: normalizeMimeType(filePart.contentType || ""),
      size: filePart.data.length,
      buffer: filePart.data,
    };
  }

  return {
    readSpeechMutationBody,
  };
}

module.exports = {
  createSpeechMutationReader,
};
