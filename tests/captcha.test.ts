/**
 * Tests for the per-IP captcha-challenge gate.
 *
 * Covers:
 *  - Requests allowed under threshold
 *  - 429 + captcha_required after threshold is reached
 *  - Authenticated (Bearer) callers bypass the gate
 *  - threshold=0 disables the gate entirely
 *  - Per-IP isolation (different IPs get separate counters)
 *  - requestId included in error response when available
 *  - Standard error envelope { error: { code, message } }
 *  - env defaults parsed correctly
 */

import request from "supertest";
import express from "express";
import { createCaptchaGate, SlidingWindowStore } from "../src/middleware/captcha";
import { requestContextStorage } from "../src/lib/requestContext";

function makeApp(
  threshold = 3,
  windowMs = 60_000,
  trustProxy = false,
  store = new SlidingWindowStore(),
) {
  const app = express();
  app.use((_req, _res, next) => {
    requestContextStorage.run({ requestId: "test-req-id" }, next);
  });
  app.use(createCaptchaGate({ threshold, windowMs, trustProxy, store }));
  app.get("/api/markets", (_req, res) => res.json({ data: [] }));
  app.get("/api/leaderboard", (_req, res) => res.json({ data: [] }));
  return { app, store };
}

describe("createCaptchaGate", () => {
  it("allows requests under the threshold", async () => {
    const { app } = makeApp(3);
    for (let i = 0; i < 3; i++) {
      await request(app).get("/api/markets").expect(200);
    }
  });

  it("issues 429 captcha_required once threshold is reached", async () => {
    const { app } = makeApp(2);
    await request(app).get("/api/markets").expect(200);
    await request(app).get("/api/markets").expect(200);
    const res = await request(app).get("/api/markets");

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("captcha_required");
    expect(typeof res.body.error.message).toBe("string");
  });

  it("includes requestId in error response", async () => {
    const { app } = makeApp(1);
    await request(app).get("/api/markets").expect(200);
    const res = await request(app).get("/api/markets");

    expect(res.status).toBe(429);
    expect(res.body.error.requestId).toBe("test-req-id");
  });

  it("applies to /api/leaderboard", async () => {
    const { app } = makeApp(1);
    await request(app).get("/api/leaderboard").expect(200);
    const res = await request(app).get("/api/leaderboard");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("captcha_required");
  });

  it("bypasses gate for Bearer-authenticated requests", async () => {
    const { app } = makeApp(1);
    await request(app).get("/api/markets").expect(200);
    // Without auth — would be blocked
    const blocked = await request(app).get("/api/markets");
    expect(blocked.status).toBe(429);

    // With auth — always passes regardless of count
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .get("/api/markets")
        .set("Authorization", "Bearer fake-token-present");
      expect(res.status).toBe(200);
    }
  });

  it("maintains separate counters per IP", async () => {
    const store = new SlidingWindowStore();
    const { app } = makeApp(1, 60_000, true, store);

    await request(app)
      .get("/api/markets")
      .set("x-forwarded-for", "10.0.0.1")
      .expect(200);

    // 10.0.0.1 is now over threshold, but 10.0.0.2 is not
    const blocked = await request(app)
      .get("/api/markets")
      .set("x-forwarded-for", "10.0.0.1");
    expect(blocked.status).toBe(429);

    const allowed = await request(app)
      .get("/api/markets")
      .set("x-forwarded-for", "10.0.0.2");
    expect(allowed.status).toBe(200);
  });

  it("is disabled when threshold is 0", async () => {
    const { app } = makeApp(0);
    for (let i = 0; i < 20; i++) {
      await request(app).get("/api/markets").expect(200);
    }
  });
});

describe("captcha env defaults", () => {
  it("parses CAPTCHA_THRESHOLD with default 10", async () => {
    const { env } = await import("../src/config/env");
    expect(env.CAPTCHA_THRESHOLD).toBe(10);
  });

  it("parses CAPTCHA_WINDOW_MS with default 60000", async () => {
    const { env } = await import("../src/config/env");
    expect(env.CAPTCHA_WINDOW_MS).toBe(60_000);
  });
});
