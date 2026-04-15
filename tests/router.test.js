import http from "node:http";
import { createRequire } from "node:module";
import request from "supertest";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createRouter } = require("../src/server/router");

describe("router auth guard", () => {
  it("blocks requiresAuth routes even when the pathname is not under /api/", async () => {
    const router = createRouter(
      {
        runtime: {
          PORT: 3000,
        },
        http: {
          applyCorsHeaders: () => {},
          sendJson: (response, statusCode, payload) => {
            response.writeHead(statusCode, {
              "Content-Type": "application/json; charset=utf-8",
            });
            response.end(JSON.stringify(payload));
          },
        },
        auth: {
          getCurrentUserFromRequest: async () => null,
        },
      },
      [
        {
          method: "GET",
          pattern: "/private",
          requiresAuth: true,
          handler: async ({ services, response }) => {
            services.http.sendJson(response, 200, { ok: true });
          },
        },
      ]
    );
    const app = http.createServer((request, response) => router(request, response));

    const response = await request(app).get("/private");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("请先登录");
  });
});
