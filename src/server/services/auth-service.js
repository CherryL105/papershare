const crypto = require("crypto");
const { promisify } = require("util");
const { getUserRole } = require("../../../shared/papershare-shared");

const scryptAsync = promisify(crypto.scrypt);

function createAuthService(deps) {
  const sessionCookieName = String(deps.sessionCookieName || "papershare_session").trim();

  async function getCurrentUserFromRequest(request) {
    const sessionToken = getSessionTokenFromRequest(request);

    if (!sessionToken) {
      return null;
    }

    const session = deps.store.sessions.getByToken(sessionToken);

    if (!session) {
      return null;
    }

    return deps.store.users.getById(session.userId) || null;
  }

  async function login(body) {
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    if (!username || !password) {
      throw new Error("用户名和密码不能为空");
    }

    let user = deps.store.users.getByUsername(username);
    const passwordVerification = await verifyPassword(password, user?.passwordHash);

    if (!user || !passwordVerification.ok) {
      throw new Error("用户名或密码错误");
    }

    const token = createSessionToken();
    const createdAt = new Date().toISOString();

    if (passwordVerification.needsRehash) {
      user = {
        ...user,
        passwordHash: await hashPassword(password),
        updatedAt: createdAt,
      };
    }

    deps.store.runInTransaction((repositories) => {
      if (passwordVerification.needsRehash) {
        repositories.users.update(user);
      }

      repositories.sessions.replaceSessionForUser({
        createdAt,
        token,
        userId: user.id,
      });
    });

    return {
      token,
      user: serializeAuthenticatedUser(user),
    };
  }

  async function deleteSession(sessionToken) {
    deps.store.sessions.deleteByToken(sessionToken);
  }

  async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derivedKey = Buffer.from(await scryptAsync(String(password), salt, 64)).toString("hex");
    return `scrypt$${salt}$${derivedKey}`;
  }

  async function verifyPassword(password, passwordHash) {
    const normalizedHash = String(passwordHash || "").trim();

    if (!normalizedHash) {
      return { ok: false, needsRehash: false };
    }

    if (normalizedHash.startsWith("scrypt$")) {
      const parts = normalizedHash.split("$");

      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        return { ok: false, needsRehash: false };
      }

      const derivedKey = Buffer.from(await scryptAsync(String(password), parts[1], 64));
      const expectedKey = Buffer.from(parts[2], "hex");
      const ok =
        derivedKey.length === expectedKey.length &&
        crypto.timingSafeEqual(derivedKey, expectedKey);

      return { ok, needsRehash: false };
    }

    const ok = createLegacyPasswordHash(password) === normalizedHash;
    return { ok, needsRehash: ok };
  }

  function getSessionTokenFromRequest(request) {
    const authorizationHeader = String(request?.headers?.authorization || "").trim();

    if (/^Bearer\s+/i.test(authorizationHeader)) {
      return authorizationHeader.replace(/^Bearer\s+/i, "").trim();
    }

    const cookies = parseCookies(request?.headers?.cookie);
    return cookies[sessionCookieName] || "";
  }

  function serializeSessionCookie(request, token) {
    return [
      `${sessionCookieName}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      ...(isSecureRequest(request) ? ["Secure"] : []),
    ].join("; ");
  }

  function serializeExpiredSessionCookie(request) {
    return [
      `${sessionCookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      ...(isSecureRequest(request) ? ["Secure"] : []),
    ].join("; ");
  }

  function serializeUser(user) {
    return {
      id: user.id,
      username: user.username,
      role: getUserRole(user),
      createdAt: user.createdAt || "",
    };
  }

  function serializeAuthenticatedUser(user) {
    return {
      ...serializeUser(user),
      mustChangePassword: Boolean(user?.mustChangePassword),
    };
  }

  return {
    deleteSession,
    getCurrentUserFromRequest,
    getSessionTokenFromRequest,
    hashPassword,
    login,
    serializeAuthenticatedUser,
    serializeExpiredSessionCookie,
    serializeSessionCookie,
    serializeUser,
    verifyPassword,
  };
}

function createLegacyPasswordHash(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function createSessionToken() {
  return `session-${Date.now()}-${crypto.randomBytes(16).toString("hex")}`;
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((cookies, segment) => {
      const separatorIndex = segment.indexOf("=");

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = segment.slice(0, separatorIndex).trim();
      const value = segment.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function isSecureRequest(request) {
  const forwardedProto = String(request?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  return forwardedProto === "https" || Boolean(request?.socket?.encrypted);
}

module.exports = {
  createAuthService,
};
