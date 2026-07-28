import { LogEvent, emitMarketEvent, getCorrelationId } from "../src/logging/events";
import { logger } from "../src/config/logger";
import { requestContextStorage } from "../src/lib/requestContext";

// Mock pino logger
jest.mock("../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockLogger = logger as jest.Mocked<typeof logger>;

describe("logging/events", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exports a stable LogEvent enum", () => {
    expect(LogEvent.MARKET_CREATED).toBe("market.created");
    expect(LogEvent.MARKET_UPDATED).toBe("market.updated");
    expect(LogEvent.MARKET_RESOLVED).toBe("market.resolved");
    expect(LogEvent.MARKET_DISPUTED).toBe("market.disputed");
    expect(LogEvent.MARKET_CLOSED).toBe("market.closed");
    expect(LogEvent.MARKET_ARCHIVED).toBe("market.archived");
  });

  it("emits structured log with event, marketId, and correlationId", () => {
    emitMarketEvent(LogEvent.MARKET_UPDATED, {
      marketId: "mkt-1",
      correlationId: "test-corr-123",
      actor: "GADMIN...",
      version: 2,
    });

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    const [payload, msg] = mockLogger.info.mock.calls[0];
    expect(payload).toMatchObject({
      event: "market.updated",
      correlationId: "test-corr-123",
      marketId: "mkt-1",
      actor: "GADMIN...",
      version: 2,
    });
    expect(msg).toBe("market:market.updated");
  });

  it("resolves correlationId from requestContext when not explicit", () => {
    requestContextStorage.run({ requestId: "req-abc-123" }, () => {
      emitMarketEvent(LogEvent.MARKET_RESOLVED, {
        marketId: "mkt-2",
        winningOutcome: "YES",
      });
    });

    const payload = mockLogger.info.mock.calls[0][0] as any;
    expect(payload.correlationId).toBe("req-abc-123");
    expect(payload.marketId).toBe("mkt-2");
    expect(payload.winningOutcome).toBe("YES");
  });

  it("generates a UUID correlationId when no context is available", () => {
    emitMarketEvent(LogEvent.MARKET_DISPUTED, {
      marketId: "mkt-3",
      disputeId: "d-1",
    });

    const payload = mockLogger.info.mock.calls[0][0] as any;
    expect(payload.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("getCorrelationId priority: explicit > requestContext > uuid", () => {
    // explicit wins
    expect(getCorrelationId("explicit-1")).toBe("explicit-1");

    // requestContext fallback
    const fromCtx = requestContextStorage.run({ requestId: "ctx-id" }, () =>
      getCorrelationId(undefined)
    );
    expect(fromCtx).toBe("ctx-id");

    // uuid fallback
    const generated = getCorrelationId(undefined);
    expect(generated).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("sanitizes sensitive keys", () => {
    emitMarketEvent(LogEvent.MARKET_UPDATED, {
      marketId: "mkt-x",
      correlationId: "c1",
      secret: "shhh",
      password: "hunter2",
      token: "jwt...",
      authorization: "Bearer ...",
      privateKey: "S...",
      apiKey: "key123",
      safeField: "keep-me",
    });

    const payload = mockLogger.info.mock.calls[0][0] as any;
    expect(payload.secret).toBe("[REDACTED]");
    expect(payload.password).toBe("[REDACTED]");
    expect(payload.token).toBe("[REDACTED]");
    expect(payload.authorization).toBe("[REDACTED]");
    expect(payload.privateKey).toBe("[REDACTED]");
    expect(payload.apiKey).toBe("[REDACTED]");
    expect(payload.safeField).toBe("keep-me");
    expect(payload.marketId).toBe("mkt-x");
  });

  it("warns and drops event when marketId is missing", () => {
    // @ts-expect-error missing marketId
    emitMarketEvent(LogEvent.MARKET_UPDATED, { actor: "x" });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      { event: "market.updated" },
      expect.stringContaining("without valid marketId")
    );
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it("emits each market lifecycle event without throwing", () => {
    const events = [
      LogEvent.MARKET_CREATED,
      LogEvent.MARKET_UPDATED,
      LogEvent.MARKET_RESOLVED,
      LogEvent.MARKET_DISPUTED,
      LogEvent.MARKET_CLOSED,
      LogEvent.MARKET_ARCHIVED,
    ];

    events.forEach((ev, i) => {
      emitMarketEvent(ev, { marketId: `m-${i}`, correlationId: "test" });
    });

    expect(mockLogger.info).toHaveBeenCalledTimes(events.length);
  });
});
