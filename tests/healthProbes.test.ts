/**
 * healthProbes.test.ts
 *
 * Unit tests for health probe functions.
 */

import {
  computeCompositeStatus,
  DependencyHealth,
} from "../src/services/healthProbes";

describe("healthProbes - computeCompositeStatus", () => {
  it("returns 'ok' when all probes are ok", () => {
    const health: DependencyHealth = {
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "ok", latencyMs: 15 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    };

    const status = computeCompositeStatus(health);
    expect(status).toBe("ok");
  });

  it("returns 'down' when any probe is down", () => {
    const health: DependencyHealth = {
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "down", latencyMs: 100, error: "RPC failed" },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    };

    const status = computeCompositeStatus(health);
    expect(status).toBe("down");
  });

  it("returns 'degraded' when some are ok and some degraded (no down)", () => {
    const health: DependencyHealth = {
      postgres: { status: "ok", latencyMs: 10 },
      sorobanRpc: { status: "degraded", latencyMs: 200 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    };

    const status = computeCompositeStatus(health);
    expect(status).toBe("degraded");
  });

  it("returns 'down' even if some are degraded and some down", () => {
    const health: DependencyHealth = {
      postgres: { status: "down", latencyMs: 100, error: "DB failed" },
      sorobanRpc: { status: "degraded", latencyMs: 200 },
      horizon: { status: "ok", latencyMs: 20 },
      webhookQueue: { status: "ok", latencyMs: 5 },
    };

    const status = computeCompositeStatus(health);
    expect(status).toBe("down");
  });
});
