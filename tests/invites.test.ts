let mockUserId: string | null = "test-user-id";

jest.mock("../src/middleware/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!mockUserId) {
      res.status(401).json({ error: { code: "unauthenticated" } });
      return;
    }
    req.user = { id: mockUserId, stellarAddress: "GTEST" };
    next();
  },
}));

jest.mock("../src/services/auditService", () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../src/lib/requestContext", () => ({
  getRequestId: jest.fn(() => "test-correlation-id"),
}));

import express from "express";
import request from "supertest";
import { createInvitesRouter } from "../src/routes/invites";
import { errorHandler } from "../src/middleware/errorHandler";

function makeApp(rateLimitCapacity = 3) {
  const app = express();
  app.use(express.json());
  const router = createInvitesRouter({ rateLimit: { capacity: rateLimitCapacity } });
  app.use("/api/invites", router);
  app.use(errorHandler);
  return app;
}

describe("POST /api/invites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = "test-user-id";
  });

  it("returns 401 when auth is rejected", async () => {
    mockUserId = null;
    const app = makeApp();

    const res = await request(app).post("/api/invites");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });

  it("returns 201 on successful invite creation", async () => {
    const app = makeApp();

    const res = await request(app).post("/api/invites");
    expect(res.status).toBe(201);
    expect(res.body.data.message).toBe("Invite created");
  });

  it("applies rate limiting to POST /api/invites", async () => {
    const app = makeApp(2);

    await request(app).post("/api/invites");
    await request(app).post("/api/invites");

    const blocked = await request(app).post("/api/invites");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limit_exceeded");
  });

  it("sets Retry-After header on rate-limited requests", async () => {
    const app = makeApp(1);

    await request(app).post("/api/invites");

    const blocked = await request(app).post("/api/invites");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("isolates rate limits per user", async () => {
    const app = makeApp(1);

    mockUserId = "user-1";
    await request(app).post("/api/invites");

    const user1Blocked = await request(app).post("/api/invites");
    expect(user1Blocked.status).toBe(429);

    mockUserId = "user-2";
    const user2Allowed = await request(app).post("/api/invites");
    expect(user2Allowed.status).toBe(201);
  });

  it("applies rate limiting to GET /api/invites", async () => {
    const app = makeApp(1);

    await request(app).get("/api/invites");

    const blocked = await request(app).get("/api/invites");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limit_exceeded");
  });

  it("includes standard rate limit headers on successful requests", async () => {
    const app = makeApp(5);

    const res = await request(app).post("/api/invites");
    expect(res.status).toBe(201);

    expect(res.headers["ratelimit-limit"]).toBe("5");
    expect(Number(res.headers["ratelimit-remaining"])).toBeGreaterThanOrEqual(0);
    expect(res.headers["ratelimit-reset"]).toBeDefined();
  });
});