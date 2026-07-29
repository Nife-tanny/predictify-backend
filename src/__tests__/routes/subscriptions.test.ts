import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import request from "supertest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { subscriptionsRouter } from "../../routes/subscriptions";
import { db } from "../../db/client";
import { generateETag } from "../../middleware/etag";

jest.mock("../../middleware/requireAdmin", () => ({
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock("../../db/client", () => {
  const mDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn(),
  };
  return { db: mDb };
});

describe("Subscriptions Routes", () => {
  let app: express.Application;

  const mockSubscriptions = [
    {
      id: "sub-1",
      url: "https://example.com/webhook",
      secret: "secret123",
      events: ["market.created"],
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/subscriptions", subscriptionsRouter);
  });

  describe("GET /api/subscriptions", () => {
    it("should return subscriptions and strong ETag", async () => {
      (db.from as jest.Mock).mockResolvedValueOnce(mockSubscriptions);

      const response = await request(app).get("/api/subscriptions");

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(JSON.parse(JSON.stringify(mockSubscriptions)));
      
      const expectedEtag = generateETag(mockSubscriptions);
      expect(response.headers.etag).toBe(expectedEtag);
      expect(response.headers["cache-control"]).toBe("no-cache");
    });

    it("should return 304 if If-None-Match matches ETag", async () => {
      (db.from as jest.Mock).mockResolvedValue(mockSubscriptions);
      
      const expectedEtag = generateETag(mockSubscriptions);
      const response = await request(app)
        .get("/api/subscriptions")
        .set("If-None-Match", expectedEtag);

      expect(response.status).toBe(304);
      expect(response.body).toEqual({});
    });

    it("should return 200 if If-None-Match does not match ETag", async () => {
      (db.from as jest.Mock).mockResolvedValueOnce(mockSubscriptions);
      
      const response = await request(app)
        .get("/api/subscriptions")
        .set("If-None-Match", '"non-matching-etag"');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(JSON.parse(JSON.stringify(mockSubscriptions)));
    });

    it("should handle db errors", async () => {
      (db.from as jest.Mock).mockRejectedValueOnce(new Error("Database error"));
      // Mute the express default error handler output in tests
      app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: "Internal Error" });
      });

      const response = await request(app).get("/api/subscriptions");

      expect(response.status).toBe(500);
    });
  });
});
