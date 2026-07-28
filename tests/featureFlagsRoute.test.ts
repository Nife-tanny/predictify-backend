/**
 * tests/featureFlagsRoute.test.ts
 *
 * Focused tests for:
 *   - GET /api/feature-flags happy path (200)
 *   - Per-request timeout → 504 gateway_timeout
 *   - No double-response when the service resolves after the deadline
 *   - Cooperative abort: RequestAbortedError is silently dropped after 504
 *   - Query-parameter validation (400 on invalid enum)
 *   - Valid optional query params are accepted
 *   - Correlation-ID header is echoed back
 *   - logger.warn is emitted with the correct shape on timeout
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/predictify_test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars!";
process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
process.env.HORIZON_URL = "https://horizon-testnet.stellar.org";
process.env.PREDICTIFY_CONTRACT_ID = "CTEST0000000000000000000000000000000000000000000000000000";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../src/services/feature-flags.service");
jest.mock("../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import request from "supertest";
import express from "express";
import { featureFlagsRouter } from "../src/routes/feature-flags";
import { FeatureFlagsService } from "../src/services/feature-flags.service";
import { logger } from "../src/config/logger";
import { correlationMiddleware } from "../src/middleware/correlation";

const mockGetFlagsForUser = FeatureFlagsService.getFlagsForUser as jest.MockedFunction<
  typeof FeatureFlagsService.getFlagsForUser
>;

// ── Test app factory ──────────────────────────────────────────────────────────

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  // Mount correlation middleware so res.locals.correlationId is populated.
  app.use(correlationMiddleware);
  app.use("/api/feature-flags", featureFlagsRouter);
  return app;
}

// ── Happy-path ────────────────────────────────────────────────────────────────

describe("GET /api/feature-flags — 200 happy path", () => {
  const MOCK_FLAGS = {
    ENABLE_DOCS: { enabled: true },
    BETA_PREDICTION_MARKETS: { enabled: false, metadata: { targetUser: null } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFlagsForUser.mockReturnValue(MOCK_FLAGS);
  });

  it("returns 200 with the flags data and correlationId", async () => {
    const res = await request(makeApp()).get("/api/feature-flags");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(MOCK_FLAGS);
    expect(typeof res.body.correlationId).toBe("string");
  });

  it("echoes X-Correlation-Id header provided by the client", async () => {
    const clientId = "test-correlation-id-abc";
    const res = await request(makeApp())
      .get("/api/feature-flags")
      .set("x-correlation-id", clientId);

    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBe(clientId);
    expect(res.headers["x-correlation-id"]).toBe(clientId);
  });

  it("generates a correlation ID when none is provided", async () => {
    const res = await request(makeApp()).get("/api/feature-flags");

    expect(res.body.correlationId).toMatch(/^[0-9a-f-]+$/i);
    expect(res.headers["x-correlation-id"]).toBeDefined();
  });

  it("accepts valid optional query parameters without error", async () => {
    const res = await request(makeApp())
      .get("/api/feature-flags")
      .query({ environment: "testnet", clientVersion: "1.2.3" });

    expect(res.status).toBe(200);
  });

  it("accepts environment=development", async () => {
    const res = await request(makeApp())
      .get("/api/feature-flags")
      .query({ environment: "development" });

    expect(res.status).toBe(200);
  });

  it("accepts environment=mainnet", async () => {
    const res = await request(makeApp())
      .get("/api/feature-flags")
      .query({ environment: "mainnet" });

    expect(res.status).toBe(200);
  });

  it("logs feature_flags_fetched at info level", async () => {
    await request(makeApp()).get("/api/feature-flags");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/", correlationId: expect.any(String) }),
      "feature_flags_fetched",
    );
  });
});

// ── Query-parameter validation ────────────────────────────────────────────────

describe("GET /api/feature-flags — query parameter validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFlagsForUser.mockReturnValue({});
  });

  it("returns 400 when environment is not a valid enum value", async () => {
    const res = await request(makeApp())
      .get("/api/feature-flags")
      .query({ environment: "staging" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("returns 400 with a requestId in the error envelope", async () => {
    const res = await request(makeApp())
      .get("/api/feature-flags")
      .query({ environment: "bad-value" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: "validation_error",
      requestId: expect.any(String),
    });
  });

  it("ignores unknown query parameters (zod strips them)", async () => {
    const res = await request(makeApp())
      .get("/api/feature-flags")
      .query({ unknownParam: "foo" });

    expect(res.status).toBe(200);
  });
});

// ── Timeout / cooperative abort ───────────────────────────────────────────────

describe("GET /api/feature-flags — per-request timeout", () => {
  /**
   * Accelerate the 5-second FEATURE_FLAGS_TIMEOUT_MS to 50 ms so the test
   * suite stays fast without jest.useFakeTimers (which can conflict with
   * supertest's async http wiring).
   */
  const originalSetTimeout = global.setTimeout;

  beforeEach(() => {
    jest.clearAllMocks();
    global.setTimeout = ((
      cb: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 5000) return originalSetTimeout(cb, 50, ...args);
      return originalSetTimeout(cb, ms, ...args);
    }) as typeof setTimeout;
  });

  afterEach(() => {
    global.setTimeout = originalSetTimeout;
  });

  it(
    "returns 504 gateway_timeout when the service hangs past the deadline",
    async () => {
      mockGetFlagsForUser.mockReturnValue(
        // Never resolves — simulates a slow upstream or lock contention
        new Promise(() => {}) as unknown as ReturnType<typeof FeatureFlagsService.getFlagsForUser>,
      );

      const res = await request(makeApp()).get("/api/feature-flags");

      expect(res.status).toBe(504);
      expect(res.body).toEqual({
        error: {
          code: "gateway_timeout",
          message: "Feature-flags request timed out",
          requestId: expect.any(String),
        },
      });
    },
    8000,
  );

  it(
    "does not double-respond when a hung service resolves after the deadline",
    async () => {
      let resolveLate!: (v: ReturnType<typeof FeatureFlagsService.getFlagsForUser>) => void;
      mockGetFlagsForUser.mockReturnValue(
        new Promise((resolve) => {
          resolveLate = resolve;
        }) as unknown as ReturnType<typeof FeatureFlagsService.getFlagsForUser>,
      );

      const res = await request(makeApp()).get("/api/feature-flags");
      expect(res.status).toBe(504);

      // Simulate the late resolution — should not throw or cause an unhandled
      // rejection because the RequestAbortedError path returns early.
      resolveLate({});
      await new Promise((r) => originalSetTimeout(r, 50));
    },
    8000,
  );

  it(
    "emits logger.warn with the correct shape when the timeout fires",
    async () => {
      mockGetFlagsForUser.mockReturnValue(
        new Promise(() => {}) as unknown as ReturnType<typeof FeatureFlagsService.getFlagsForUser>,
      );

      const clientCorrelationId = "warn-shape-test-001";
      await request(makeApp())
        .get("/api/feature-flags")
        .set("x-correlation-id", clientCorrelationId);

      // The requestTimeout middleware should have warned with these fields.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: clientCorrelationId,
          timeoutMs: 5000,
          path: expect.stringContaining("feature-flags"),
          method: "GET",
        }),
        "request_timeout_exceeded",
      );
    },
    8000,
  );

  it(
    "logs a breadcrumb when the RequestAbortedError is caught in the handler",
    async () => {
      mockGetFlagsForUser.mockReturnValue(
        new Promise(() => {}) as unknown as ReturnType<typeof FeatureFlagsService.getFlagsForUser>,
      );

      await request(makeApp()).get("/api/feature-flags");

      // The route handler should log 'Abandoned /api/feature-flags request after timeout'
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: expect.any(String), path: "/" }),
        "Abandoned /api/feature-flags request after timeout",
      );
    },
    8000,
  );

  it(
    "responds normally within the deadline when the service resolves quickly",
    async () => {
      const flags = { ENABLE_DOCS: { enabled: true } };
      mockGetFlagsForUser.mockReturnValue(flags);

      const res = await request(makeApp()).get("/api/feature-flags");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(flags);
    },
    8000,
  );
});
