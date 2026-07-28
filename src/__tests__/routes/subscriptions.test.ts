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
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn(),
  };
  return { db: mDb };
});

jest.mock("../../services/auditService", () => ({
  createAuditLog: jest.fn().mockResolvedValue("corr-id"),
}));

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

  describe("Mutations", () => {
    it("POST /api/subscriptions creates and audits", async () => {
      const newRow = { id: "sub-2", url: "https://x", events: [], active: true };
      (db.insert as jest.Mock).mockReturnThis();
      (db.values as jest.Mock).mockReturnThis();
      (db.returning as jest.Mock).mockResolvedValueOnce([newRow]);

      const response = await request(app).post("/api/subscriptions").send({ url: newRow.url, events: newRow.events });

      expect(response.status).toBe(201);
      expect(response.body.data).toEqual(JSON.parse(JSON.stringify(newRow)));
      const { createAuditLog } = require("../../services/auditService");
      expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.subscription.create", afterState: newRow }));
    });

    it("PATCH /api/subscriptions/:id updates and audits", async () => {
      const existing = { id: "sub-3", url: "https://old", events: [], active: true };
      const updated = { ...existing, url: "https://new" };

      (db.from as jest.Mock).mockResolvedValueOnce([existing]);
      (db.update as jest.Mock).mockReturnThis();
      (db.set as jest.Mock).mockReturnThis();
      (db.returning as jest.Mock).mockResolvedValueOnce([updated]);

      const response = await request(app).patch(`/api/subscriptions/${existing.id}`).send({ url: updated.url });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(JSON.parse(JSON.stringify(updated)));
      const { createAuditLog } = require("../../services/auditService");
      expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.subscription.update", beforeState: existing, afterState: updated }));
    });

    it("DELETE /api/subscriptions/:id deletes and audits", async () => {
      const existing = { id: "sub-4", url: "https://del", events: [], active: true };

      (db.from as jest.Mock).mockResolvedValueOnce([existing]);
      (db.delete as jest.Mock).mockResolvedValueOnce({ rowCount: 1 });

      const response = await request(app).delete(`/api/subscriptions/${existing.id}`);

      expect(response.status).toBe(204);
      const { createAuditLog } = require("../../services/auditService");
      expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.subscription.delete", beforeState: existing, afterState: null }));
    });
  });
});
