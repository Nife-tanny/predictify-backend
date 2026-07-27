import express from "express";
import request from "supertest";
import { v4 as uuidv4 } from "uuid";
import { closeDb, pool } from "../../src/db/client";
import { closeAuthPool } from "../../src/middleware/requireAuth";
import { signAccessToken } from "../../src/services/jwtService";
import { requestContextStorage } from "../../src/lib/requestContext";

jest.mock("../../src/queue", () => ({
  redisConnection: {
    on: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
    quit: jest.fn(),
  },
  webhookQueueName: "webhook-deliveries",
  backupVerificationQueueName: "backup-verification",
  reconciliationQueueName: "reconciliation",
  marketResolutionQueueName: "market-resolution",
  webhookQueue: {},
  backupVerificationQueue: {},
  reconciliationQueue: {},
  marketResolutionQueue: {},
}));

jest.mock("../../src/cache/marketsCache", () => ({
  marketCacheKeys: {
    all: "markets:all",
    byId: (marketId: string) => `markets:${marketId}`,
  },
  invalidateMarketCache: jest.fn().mockResolvedValue(undefined),
}));

import { marketsRouter } from "../../src/routes/markets";

const NON_ADMIN_ADDRESS = "GUSER22222222222222222222222222222222222222222222222222";

async function seedMarkets(rows: Array<{
  id: string;
  question: string;
  status: string;
  resolutionTime: string;
  archived?: boolean;
  version?: number;
  featured?: boolean;
}>) {
  for (const row of rows) {
    await pool.query(
      `
        INSERT INTO markets (
          id,
          question,
          status,
          resolution_time,
          indexed_ledger,
          archived,
          version,
          featured,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
      [
        row.id,
        row.question,
        row.status,
        row.resolutionTime,
        1,
        row.archived ?? false,
        row.version ?? 1,
        row.featured ?? false,
      ],
    );
  }
}

function createMarketsApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    requestContextStorage.run({ requestId: uuidv4() }, next);
  });
  app.use("/api/markets", marketsRouter);
  return app;
}

function nonAdminToken() {
  return signAccessToken({ sub: NON_ADMIN_ADDRESS });
}

describe("Markets integration", () => {
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE TABLE markets RESTART IDENTITY CASCADE",
    );
  });

  afterAll(async () => {
    await closeAuthPool();
    await closeDb();
  });

  describe("GET /api/markets listing", () => {
    it("returns markets persisted in the database", async () => {
      await seedMarkets([
        {
          id: "market-live",
          question: "Will the integration test pass?",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [
          {
            id: "market-live",
            question: "Will the integration test pass?",
            status: "active",
            resolutionTime: "2026-07-01T00:00:00.000Z",
          },
        ],
        nextCursor: null,
      });
    });

    it("returns an empty array when no markets exist", async () => {
      const res = await request(createMarketsApp()).get("/api/markets");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.nextCursor).toBeNull();
    });

    it("omits archived markets from the public listing", async () => {
      await seedMarkets([
        {
          id: "market-active",
          question: "Visible market",
          status: "active",
          resolutionTime: "2026-07-02T00:00:00.000Z",
        },
        {
          id: "market-archived",
          question: "Hidden market",
          status: "archived",
          resolutionTime: "2026-07-03T00:00:00.000Z",
          archived: true,
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ id: "market-active" });
    });

    it("respects the limit query parameter", async () => {
      await seedMarkets([
        {
          id: "market-one",
          question: "First",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "market-two",
          question: "Second",
          status: "active",
          resolutionTime: "2026-07-02T00:00:00.000Z",
        },
        {
          id: "market-three",
          question: "Third",
          status: "active",
          resolutionTime: "2026-07-03T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets?limit=2");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it("returns a valid x-request-id header", async () => {
      await seedMarkets([
        {
          id: "market-header",
          question: "Header check",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets");

      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(typeof res.headers["x-request-id"]).toBe("string");
    });

    it("returns a standardized error envelope on invalid input", async () => {
      const res = await request(createMarketsApp()).get("/api/markets?limit=abc");

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toHaveProperty("type");
      expect(res.body.error).toHaveProperty("message");
      expect(res.body.error).toHaveProperty("correlationId");
    });
  });

  describe("GET /api/markets/:id", () => {
    it("returns a single market by id from the database", async () => {
      await seedMarkets([
        {
          id: "market-detail",
          question: "Single detail lookup",
          status: "active",
          resolutionTime: "2026-07-04T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets/market-detail");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          id: "market-detail",
          question: "Single detail lookup",
          status: "active",
          resolutionTime: "2026-07-04T00:00:00.000Z",
          version: 1,
        },
      });
    });

    it("returns 404 when market is not found", async () => {
      const res = await request(createMarketsApp()).get("/api/markets/nonexistent-id");

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error.type).toBe("NotFound");
      expect(res.body.error).toHaveProperty("correlationId");
    });

    it("returns a valid x-request-id header on 404", async () => {
      const res = await request(createMarketsApp()).get("/api/markets/nonexistent-id");

      expect(res.status).toBe(404);
      expect(res.headers["x-request-id"]).toBeDefined();
    });
  });

  describe("GET /api/markets/search", () => {
    it("returns 400 when q parameter is missing", async () => {
      await seedMarkets([
        {
          id: "market-search-1",
          question: "Will it rain today?",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets/search");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error.type).toBe("ValidationError");
    });

    it("returns 400 when q parameter is empty", async () => {
      await seedMarkets([
        {
          id: "market-search-2",
          question: "Will it rain today?",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets/search?q=");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 200 with search results matching the query", async () => {
      await seedMarkets([
        {
          id: "market-search-3",
          question: "Will it rain today in San Francisco?",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "market-search-4",
          question: "Will the sun shine in New York?",
          status: "active",
          resolutionTime: "2026-07-02T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get(
        "/api/markets/search?q=rain",
      );

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("total");
      expect(Array.isArray(res.body.data)).toBe(true);
      for (const market of res.body.data) {
        expect(market.question.toLowerCase()).toContain("rain");
      }
    });

    it("returns an empty data array when no matches are found", async () => {
      await seedMarkets([
        {
          id: "market-search-5",
          question: "Will it rain today?",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get(
        "/api/markets/search?q=nonexistenttopicxyz",
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it("respects the limit query parameter", async () => {
      await seedMarkets([
        {
          id: "market-search-6",
          question: "Rain in SF",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "market-search-7",
          question: "Sun in NY",
          status: "active",
          resolutionTime: "2026-07-02T00:00:00.000Z",
        },
        {
          id: "market-search-8",
          question: "Snow in Denver",
          status: "active",
          resolutionTime: "2026-07-03T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get(
        "/api/markets/search?q=will&limit=1",
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("returns a valid x-request-id header", async () => {
      await seedMarkets([
        {
          id: "market-search-9",
          question: "Search header check",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get(
        "/api/markets/search?q=header",
      );

      expect(res.headers["x-request-id"]).toBeDefined();
    });
  });

  describe("GET /api/markets/featured", () => {
    it("returns featured markets", async () => {
      await seedMarkets([
        {
          id: "market-featured-1",
          question: "Featured market question",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
          featured: true,
        },
        {
          id: "market-not-featured",
          question: "Not featured market",
          status: "active",
          resolutionTime: "2026-07-02T00:00:00.000Z",
          featured: false,
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets/featured");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
      for (const market of res.body.data) {
        expect(market.id).toBe("market-featured-1");
      }
    });

    it("returns an empty array when no featured markets exist", async () => {
      await seedMarkets([
        {
          id: "market-not-featured-2",
          question: "Not featured",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
          featured: false,
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets/featured");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("returns a valid x-request-id header", async () => {
      const res = await request(createMarketsApp()).get("/api/markets/featured");

      expect(res.headers["x-request-id"]).toBeDefined();
    });
  });

  describe("GET /api/markets/upcoming", () => {
    it("returns markets with upcoming statuses", async () => {
      await seedMarkets([
        {
          id: "market-upcoming-1",
          question: "Upcoming market",
          status: "upcoming",
          resolutionTime: "2026-12-01T00:00:00.000Z",
        },
        {
          id: "market-active-1",
          question: "Active market",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
        {
          id: "market-pending-1",
          question: "Pending market",
          status: "pending",
          resolutionTime: "2026-12-15T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets/upcoming");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
      const returnedIds = res.body.data.map(
        (m: { id: string }) => m.id,
      );
      expect(returnedIds).toContain("market-upcoming-1");
      expect(returnedIds).toContain("market-pending-1");
      expect(returnedIds).not.toContain("market-active-1");
    });

    it("returns an empty array when no upcoming markets exist", async () => {
      await seedMarkets([
        {
          id: "market-active-2",
          question: "Active market only",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get("/api/markets/upcoming");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it("respects the limit query parameter", async () => {
      await seedMarkets([
        {
          id: "market-upcoming-2",
          question: "Upcoming 1",
          status: "upcoming",
          resolutionTime: "2026-12-01T00:00:00.000Z",
        },
        {
          id: "market-upcoming-3",
          question: "Upcoming 2",
          status: "upcoming",
          resolutionTime: "2026-12-02T00:00:00.000Z",
        },
        {
          id: "market-upcoming-4",
          question: "Upcoming 3",
          status: "upcoming",
          resolutionTime: "2026-12-03T00:00:00.000Z",
        },
      ]);

      const res = await request(createMarketsApp()).get(
        "/api/markets/upcoming?limit=2",
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it("returns a valid x-request-id header", async () => {
      const res = await request(createMarketsApp()).get("/api/markets/upcoming");

      expect(res.headers["x-request-id"]).toBeDefined();
    });
  });

  describe("PATCH /api/markets/:id (admin)", () => {
    it("returns 401 when no token is provided", async () => {
      const res = await request(createMarketsApp())
        .patch("/api/markets/market-patch-1")
        .send({
          question: "Updated question?",
          expectedVersion: 1,
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 401 when the token is malformed", async () => {
      const res = await request(createMarketsApp())
        .patch("/api/markets/market-patch-1")
        .set("Authorization", "Bearer not-a-real-jwt")
        .send({
          question: "Updated question?",
          expectedVersion: 1,
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 401 when the token has no matching user", async () => {
      const unknownToken = signAccessToken({ sub: "GUNKNOWNADDRESS" });

      const res = await request(createMarketsApp())
        .patch("/api/markets/market-patch-1")
        .set("Authorization", `Bearer ${unknownToken}`)
        .send({
          question: "Updated question?",
          expectedVersion: 1,
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 403 when a non-admin address is used", async () => {
      await seedMarkets([
        {
          id: "market-patch-1",
          question: "Original question",
          status: "active",
          resolutionTime: "2026-07-01T00:00:00.000Z",
          version: 1,
        },
      ]);

      const res = await request(createMarketsApp())
        .patch("/api/markets/market-patch-1")
        .set("Authorization", `Bearer ${nonAdminToken()}`)
        .send({
          question: "Updated question?",
          expectedVersion: 1,
        });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error");
    });
  });
});