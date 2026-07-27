import express from "express";
import request from "supertest";
import { auditRouter } from "../../routes/audit";

// Mock the logger to prevent test output noise
jest.mock("../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("auditRouter", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use("/api/audit", auditRouter);
  });

  describe("GET /api/audit", () => {
    it("returns a list of audit events", async () => {
      const response = await request(app).get("/api/audit");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ events: [] });
    });

    it("accepts a valid limit query parameter", async () => {
      const response = await request(app).get("/api/audit?limit=5");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ events: [] });
    });

    it("returns 400 if limit is not a number", async () => {
      const response = await request(app).get("/api/audit?limit=abc");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: "invalid_input",
          message: "Limit must be between 1 and 100",
        },
      });
    });

    it("returns 400 if limit is less than 1", async () => {
      const response = await request(app).get("/api/audit?limit=0");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: "invalid_input",
          message: "Limit must be between 1 and 100",
        },
      });
    });

    it("returns 400 if limit is greater than 100", async () => {
      const response = await request(app).get("/api/audit?limit=101");

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: {
          code: "invalid_input",
          message: "Limit must be between 1 and 100",
        },
      });
    });
  });
});
