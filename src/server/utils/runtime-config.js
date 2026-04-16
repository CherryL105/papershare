const fsSync = require("fs");
const path = require("path");

function loadRuntimeConfig({ env = process.env, rootDir }) {
  const normalizedRootDir = path.resolve(String(rootDir || ""));
  loadEnvFile(path.join(normalizedRootDir, ".env"));

  return {
    allowedOrigins: parseAllowedOrigins(env.PAPERSHARE_ALLOWED_ORIGINS),
    port: Number(env.PORT) || 3000,
    storageDir: resolveStorageDirectory(normalizedRootDir, env.PAPERSHARE_STORAGE_DIR),
  };
}

function loadEnvFile(filePath) {
  let rawEnv = "";

  try {
    rawEnv = fsSync.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  rawEnv.split(/\r?\n/).forEach((line) => {
    const parsedEntry = parseEnvLine(line);

    if (!parsedEntry || Object.prototype.hasOwnProperty.call(process.env, parsedEntry.key)) {
      return;
    }

    process.env[parsedEntry.key] = parsedEntry.value;
  });
}

function parseEnvLine(line) {
  const trimmedLine = String(line || "").trim();

  if (!trimmedLine || trimmedLine.startsWith("#")) {
    return null;
  }

  const normalizedLine = trimmedLine.startsWith("export ")
    ? trimmedLine.slice("export ".length).trim()
    : trimmedLine;
  const separatorIndex = normalizedLine.indexOf("=");

  if (separatorIndex <= 0) {
    return null;
  }

  const key = normalizedLine.slice(0, separatorIndex).trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  let value = normalizedLine.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const quote = value[0];
    value = value.slice(1, -1);

    if (quote === '"') {
      value = value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else {
      value = value.replace(/\\'/g, "'");
    }
  } else {
    const commentIndex = value.indexOf(" #");
    if (commentIndex >= 0) {
      value = value.slice(0, commentIndex).trimEnd();
    }
  }

  return { key, value };
}

function resolveStorageDirectory(rootDir, configuredPath) {
  const normalizedRootDir = path.resolve(String(rootDir || ""));
  const normalizedPath = String(configuredPath || "").trim();

  if (!normalizedPath) {
    return path.join(normalizedRootDir, ".local", "storage");
  }

  return path.isAbsolute(normalizedPath)
    ? normalizedPath
    : path.resolve(normalizedRootDir, normalizedPath);
}

function parseAllowedOrigins(rawValue) {
  return new Set(
    String(rawValue || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

module.exports = {
  loadEnvFile,
  loadRuntimeConfig,
  parseAllowedOrigins,
  parseEnvLine,
  resolveStorageDirectory,
};
