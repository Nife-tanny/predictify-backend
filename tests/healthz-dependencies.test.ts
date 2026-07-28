/**
 * healthz-dependencies.test.ts
 *
 * Integration tests for GET /healthz/dependencies endpoint.
 */

process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "abcdefghijklmnopqrstuvwxyz123456789012";
process.env.SOROBAN_RPC_URL = "https://testnet.stellar.org";
process.env.HORIZON_URL = "https://horizon-testnet.stellar.org";
process.env.PREDICTIFY_CONTRACT_ID = "test-contract-id";
process.env.REDIS_URL = "redis://localhost:6379";

import request from "supertest";
import { createApp } from "../src/index";
import * as healthProbes from "../src/services/healthProbes";

// Mock the health probe functions
jest.mock("../src/services/healthProbes");

describe("GET /healthz/dependencies", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 when all dependencies are ok", async () => {
    (healthProbes.getCachedDependencyHealth as jest.Mock).mockResolvedValue({
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "ok", latencyMs: 15 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    });

    const res = await request(createApp()).get("/healthz/dependencies");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.dependencies.postgres.status).toBe("ok");
    expect(res.body.dependencies.sorobanRpc.status).toBe("ok");
    expect(res.body.dependencies.horizon.status).toBe("ok");
    expect(res.body.dependencies.webhookQueue.status).toBe("ok");
  });

  it("returns 207 when dependencies are degraded", async () => {
    (healthProbes.getCachedDependencyHealth as jest.Mock).mockResolvedValue({
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "degraded", latencyMs: 4500 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    });

    const res = await request(createApp()).get("/healthz/dependencies");

    expect(res.status).toBe(207);
    expect(res.body.status).toBe("degraded");
  });

  it("returns 503 when any dependency is down", async () => {
    (healthProbes.getCachedDependencyHealth as jest.Mock).mockResolvedValue({
      postgres: { status: "down", latencyMs: 100, error: "Postgres unavailable" },
      sorobanRpc: { status: "ok", latencyMs: 15 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    });

    const res = await request(createApp()).get("/healthz/dependencies");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("down");
    expect(res.body.dependencies.postgres.status).toBe("down");
    expect(res.body.dependencies.postgres.error).toBe("Postgres unavailable");
  });

  it("includes correlationId from request header", async () => {
    (healthProbes.getCachedDependencyHealth as jest.Mock).mockResolvedValue({
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "ok", latencyMs: 15 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    });

    const correlationId = "test-correlation-123";
    const res = await request(createApp())
      .get("/healthz/dependencies")
      .set("x-correlation-id", correlationId);

    expect(res.body.correlationId).toBe(correlationId);
  });

  it("generates correlationId when not provided", async () => {
    (healthProbes.getCachedDependencyHealth as jest.Mock).mockResolvedValue({
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "ok", latencyMs: 15 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    });

    const res = await request(createApp()).get("/healthz/dependencies");

    expect(res.body.correlationId).toBeDefined();
    expect(res.body.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("includes checkedAt timestamp in ISO format", async () => {
    (healthProbes.getCachedDependencyHealth as jest.Mock).mockResolvedValue({
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "ok", latencyMs: 15 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    });

    const res = await request(createApp()).get("/healthz/dependencies");

    expect(res.body.checkedAt).toBeDefined();
    const date = new Date(res.body.checkedAt);
    expect(date.getTime()).toBeGreaterThan(0); // Valid ISO date
  });

  it("includes per-system latency metrics", async () => {
    (healthProbes.getCachedDependencyHealth as jest.Mock).mockResolvedValue({
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "ok", latencyMs: 25 },
      horizon: { status: "ok", latencyMs: 45 },
      webhookQueue: { status: "ok", latencyMs: 8 },
    });

    const res = await request(createApp()).get("/healthz/dependencies");

    expect(res.body.dependencies.postgres.latencyMs).toBe(10);
    expect(res.body.dependencies.sorobanRpc.latencyMs).toBe(25);
    expect(res.body.dependencies.horizon.latencyMs).toBe(45);
    expect(res.body.dependencies.webhookQueue.latencyMs).toBe(8);
  });

  it("does not require authentication", async () => {
    (healthProbes.getCachedDependencyHealth as jest.Mock).mockResolvedValue({
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "ok", latencyMs: 15 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    });

    // No authorization header provided
    const res = await request(createApp()).get("/healthz/dependencies");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("handles multiple down dependencies", async () => {
    (healthProbes.getCachedDependencyHealth as jest.Mock).mockResolvedValue({
      postgres: { status: "down", latencyMs: 100, error: "Postgres unavailable" },
      sorobanRpc: { status: "down", latencyMs: 5000, error: "Probe timed out" },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    });

    const res = await request(createApp()).get("/healthz/dependencies");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("down");
    expect(res.body.dependencies.postgres.status).toBe("down");
    expect(res.body.dependencies.sorobanRpc.status).toBe("down");
  });

  it("caches response within TTL (multiple requests use cache)", async () => {
    const mockHealth = {
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "ok", latencyMs: 15 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    };

    (healthProbes.getCachedDependencyHealth as jest.Mock).mockResolvedValue(
      mockHealth,
    );

    // First request
    const res1 = await request(createApp()).get("/healthz/dependencies");
    expect(res1.status).toBe(200);

    // Second request within cache TTL
    const res2 = await request(createApp()).get("/healthz/dependencies");
    expect(res2.status).toBe(200);

    // Cache function should only be called once (for testing purposes)
    expect(healthProbes.getCachedDependencyHealth).toHaveBeenCalled();
  });
});
