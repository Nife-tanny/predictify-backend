process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "abcdefghijklmnopqrstuvwxyz123456789012";
process.env.SOROBAN_RPC_URL = "https://testnet.stellar.org";
process.env.HORIZON_URL = "https://horizon-testnet.stellar.org";
process.env.PREDICTIFY_CONTRACT_ID = "test-contract-id";

/**
 * Tests for GET /api/subscriptions
 *
 * Strategy:
 *  - Mock src/db/client so no database is needed.
 *  - Sign real JWTs with the test JWT_SECRET so requireAdmin executes its
 *    full verification path (mirrors tests/adminUsers.test.ts).
 *  - Mount subscriptionsRouter directly so securityHeaders and requireAdmin
 *    run exactly as they do in the real app, in the real order.
 */

import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { subscriptionsRouter } from "../src/routes/subscriptions";
import { API_SECURITY_HEADERS } from "../src/middleware/securityHeaders";

jest.mock("../src/db/client", () => {
  const mDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn(),
  };
  return { db: mDb };
});

import { db } from "../src/db/client";

const SECRET = process.env.JWT_SECRET!;
const ISSUER = process.env.JWT_ISSUER ?? "predictify";
const AUDIENCE = process.env.JWT_AUDIENCE ?? "predictify-app";
const ADMIN_ADDRESS = "GADMIN7777777777777777777777777777777777777777777777777777";

function signJwt(payload: object): string {
  return jwt.sign(payload, SECRET, { issuer: ISSUER, audience: AUDIENCE, expiresIn: "1h" });
}

const adminJwt = signJwt({ sub: ADMIN_ADDRESS, role: "admin" });

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/subscriptions", subscriptionsRouter);
  return app;
}

const mockSubscriptions = [
  {
    id: "sub-1",
    url: "https://example.com/webhook",
    events: ["market.created"],
    active: true,
  },
];

function expectSecurityHeaders(res: request.Response) {
  for (const [header, value] of Object.entries(API_SECURITY_HEADERS)) {
    expect(res.headers[header.toLowerCase()]).toBe(value);
  }
}

describe("GET /api/subscriptions", () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns subscriptions for an authenticated admin", async () => {
    (db.from as jest.Mock).mockResolvedValueOnce(mockSubscriptions);

    const res = await request(app)
      .get("/api/subscriptions")
      .set("Authorization", `Bearer ${adminJwt}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(mockSubscriptions);
  });

  it("sets CSP, X-Content-Type-Options, and Referrer-Policy on a successful response", async () => {
    (db.from as jest.Mock).mockResolvedValueOnce(mockSubscriptions);

    const res = await request(app)
      .get("/api/subscriptions")
      .set("Authorization", `Bearer ${adminJwt}`);

    expectSecurityHeaders(res);
  });

  it("rejects an unauthenticated request with 403", async () => {
    const res = await request(app).get("/api/subscriptions");

    expect(res.status).toBe(403);
  });

  it("still sets the security headers on the 403 an unauthenticated request receives", async () => {
    // securityHeaders is mounted ahead of requireAdmin, so the headers must
    // be present even when auth rejects the request before it reaches the
    // route handler / database.
    const res = await request(app).get("/api/subscriptions");

    expectSecurityHeaders(res);
  });

  it("still sets the security headers when a non-admin token is rejected with 403", async () => {
    const userJwt = signJwt({ sub: "GUSER1", role: "user" });

    const res = await request(app)
      .get("/api/subscriptions")
      .set("Authorization", `Bearer ${userJwt}`);

    expect(res.status).toBe(403);
    expectSecurityHeaders(res);
  });
});
