/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import request from "supertest";
import express from "express";
import { leaderboardRouter } from "../../routes/leaderboard";
import * as leaderboardService from "../../services/leaderboardService";

// Mock the service
jest.mock("../../services/leaderboardService");

describe("Leaderboard Routes", () => {
  let app: express.Application;

  const mockLeaderboardEntry = {
    user_id: "user-123",
    stellar_address: "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF",
    total_predictions: 100,
    correct_predictions: 85,
    accuracy_percentage: 85.0,
    rank: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/leaderboard", leaderboardRouter);
  });

  describe("GET /api/leaderboard", () => {
    it("should return leaderboard with default parameters", async () => {
      (leaderboardService.getLeaderboard as any).mockResolvedValueOnce([
        mockLeaderboardEntry,
      ]);

      const response = await request(app).get("/api/leaderboard");

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([mockLeaderboardEntry]);
      expect(response.body.meta).toEqual({
        limit: 50,
        offset: 0,
        count: 1,
        refresh: false,
        period: "all-time",
      });
    });

    it("should accept period parameter", async () => {
      (leaderboardService.getLeaderboard as any).mockResolvedValueOnce([
        mockLeaderboardEntry,
      ]);

      const response = await request(app)
        .get("/api/leaderboard")
        .query({ period: "monthly" });

      expect(response.status).toBe(200);
      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        50,
        0,
        "monthly",
      );
      expect(response.body.meta.period).toBe("monthly");
    });

    it("should accept weekly period", async () => {
      (leaderboardService.getLeaderboard as any).mockResolvedValueOnce([
        mockLeaderboardEntry,
      ]);

      const response = await request(app)
        .get("/api/leaderboard")
        .query({ period: "weekly" });

      expect(response.status).toBe(200);
      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        50,
        0,
        "weekly",
      );
      expect(response.body.meta.period).toBe("weekly");
    });

    it("should reject invalid period", async () => {
      const response = await request(app)
        .get("/api/leaderboard")
        .query({ period: "invalid-period" });

      expect(response.status).toBe(400);
    });

    it("should accept limit parameter", async () => {
      (leaderboardService.getLeaderboard as any).mockResolvedValueOnce([
        mockLeaderboardEntry,
      ]);

      const response = await request(app)
        .get("/api/leaderboard")
        .query({ limit: 25 });

      expect(response.status).toBe(200);
      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        25,
        0,
        "all-time",
      );
      expect(response.body.meta.limit).toBe(25);
    });

    it("should accept offset parameter", async () => {
      (leaderboardService.getLeaderboard as any).mockResolvedValueOnce([
        mockLeaderboardEntry,
      ]);

      const response = await request(app)
        .get("/api/leaderboard")
        .query({ offset: 100 });

      expect(response.status).toBe(200);
      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        50,
        100,
        "all-time",
      );
      expect(response.body.meta.offset).toBe(100);
    });

    it("should reject negative limit", async () => {
      const response = await request(app)
        .get("/api/leaderboard")
        .query({ limit: -1 });

      expect(response.status).toBe(400);
    });

    it("should reject limit exceeding 100", async () => {
      const response = await request(app)
        .get("/api/leaderboard")
        .query({ limit: 101 });

      expect(response.status).toBe(400);
    });

    it("should reject negative offset", async () => {
      const response = await request(app)
        .get("/api/leaderboard")
        .query({ offset: -1 });

      expect(response.status).toBe(400);
    });

    it("should support refresh parameter with all-time period", async () => {
      (
        leaderboardService.getLeaderboardWithRefresh as jest.Mock
      ).mockResolvedValueOnce([mockLeaderboardEntry]);

      const response = await request(app)
        .get("/api/leaderboard")
        .query({ refresh: true });

      expect(response.status).toBe(200);
      expect(leaderboardService.getLeaderboardWithRefresh).toHaveBeenCalledWith(
        50,
        0,
        "all-time",
      );
      expect(response.body.meta.refresh).toBe(true);
    });

    it("should support refresh parameter with monthly period", async () => {
      (
        leaderboardService.getLeaderboardWithRefresh as jest.Mock
      ).mockResolvedValueOnce([mockLeaderboardEntry]);

      const response = await request(app)
        .get("/api/leaderboard")
        .query({ refresh: true, period: "monthly" });

      expect(response.status).toBe(200);
      expect(leaderboardService.getLeaderboardWithRefresh).toHaveBeenCalledWith(
        50,
        0,
        "monthly",
      );
    });

    it("should support refresh parameter with weekly period", async () => {
      (
        leaderboardService.getLeaderboardWithRefresh as jest.Mock
      ).mockResolvedValueOnce([mockLeaderboardEntry]);

      const response = await request(app)
        .get("/api/leaderboard")
        .query({ refresh: true, period: "weekly" });

      expect(response.status).toBe(200);
      expect(leaderboardService.getLeaderboardWithRefresh).toHaveBeenCalledWith(
        50,
        0,
        "weekly",
      );
    });

    it("should return empty array when no results", async () => {
      (leaderboardService.getLeaderboard as jest.Mock).mockResolvedValueOnce(
        [],
      );

      const response = await request(app).get("/api/leaderboard");

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.meta.count).toBe(0);
    });

    it("should handle service errors", async () => {
      (leaderboardService.getLeaderboard as jest.Mock).mockRejectedValueOnce(
        new Error("Database error"),
      );

      const response = await request(app).get("/api/leaderboard");

      expect(response.status).toBe(500);
    });

    it("should coerce string parameters to correct types", async () => {
      (leaderboardService.getLeaderboard as any).mockResolvedValueOnce([
        mockLeaderboardEntry,
      ]);

      const response = await request(app)
        .get("/api/leaderboard")
        .query({ limit: "25", offset: "50", refresh: "true" });

      expect(response.status).toBe(200);
      expect(leaderboardService.getLeaderboard).toHaveBeenCalledWith(
        25,
        50,
        "all-time",
      );
      expect(response.body.meta.limit).toBe(25);
      expect(response.body.meta.offset).toBe(50);
      expect(response.body.meta.refresh).toBe(true);
    });
  });

  describe("GET /api/leaderboard/user/:stellarAddress", () => {
    it("should return user leaderboard entry with default period", async () => {
      (
        leaderboardService.getUserLeaderboardEntry as jest.Mock
      ).mockResolvedValueOnce(mockLeaderboardEntry);

      const response = await request(app).get(
        `/api/leaderboard/user/${mockLeaderboardEntry.stellar_address}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockLeaderboardEntry);
      expect(leaderboardService.getUserLeaderboardEntry).toHaveBeenCalledWith(
        mockLeaderboardEntry.stellar_address,
        "all-time",
      );
    });

    it("should accept period parameter for user endpoint", async () => {
      (
        leaderboardService.getUserLeaderboardEntry as jest.Mock
      ).mockResolvedValueOnce(mockLeaderboardEntry);

      const response = await request(app)
        .get(`/api/leaderboard/user/${mockLeaderboardEntry.stellar_address}`)
        .query({ period: "monthly" });

      expect(response.status).toBe(200);
      expect(leaderboardService.getUserLeaderboardEntry).toHaveBeenCalledWith(
        mockLeaderboardEntry.stellar_address,
        "monthly",
      );
    });

    it("should accept weekly period for user endpoint", async () => {
      (
        leaderboardService.getUserLeaderboardEntry as jest.Mock
      ).mockResolvedValueOnce(mockLeaderboardEntry);

      const response = await request(app)
        .get(`/api/leaderboard/user/${mockLeaderboardEntry.stellar_address}`)
        .query({ period: "weekly" });

      expect(response.status).toBe(200);
      expect(leaderboardService.getUserLeaderboardEntry).toHaveBeenCalledWith(
        mockLeaderboardEntry.stellar_address,
        "weekly",
      );
    });

    it("should reject invalid period for user endpoint", async () => {
      const response = await request(app)
        .get(`/api/leaderboard/user/${mockLeaderboardEntry.stellar_address}`)
        .query({ period: "invalid" });

      expect(response.status).toBe(400);
    });

    it("should return 404 when user not found", async () => {
      (
        leaderboardService.getUserLeaderboardEntry as jest.Mock
      ).mockResolvedValueOnce(null);

      const response = await request(app).get(
        "/api/leaderboard/user/UNKNOWN_ADDRESS",
      );

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("not_found");
    });

    it("should handle service errors for user endpoint", async () => {
      (
        leaderboardService.getUserLeaderboardEntry as jest.Mock
      ).mockRejectedValueOnce(new Error("Database error"));

      const response = await request(app).get(
        `/api/leaderboard/user/${mockLeaderboardEntry.stellar_address}`,
      );

      expect(response.status).toBe(500);
    });

    it("should work with different stellar addresses", async () => {
      const altAddress =
        "GBTCHKHMWCS5TOX2LAD4DAEKTC3UFSFXQ2MRLED5EYOA34RH4ZX72JK";
      (
        leaderboardService.getUserLeaderboardEntry as jest.Mock
      ).mockResolvedValueOnce({
        ...mockLeaderboardEntry,
        stellar_address: altAddress,
      });

      const response = await request(app).get(
        `/api/leaderboard/user/${altAddress}`,
      );

      expect(response.status).toBe(200);
      expect(leaderboardService.getUserLeaderboardEntry).toHaveBeenCalledWith(
        altAddress,
        "all-time",
      );
    });
  });

  describe("Response format validation", () => {
    it("should include all required meta fields", async () => {
      (leaderboardService.getLeaderboard as any).mockResolvedValueOnce([
        mockLeaderboardEntry,
      ]);

      const response = await request(app).get("/api/leaderboard");

      expect(response.body.meta).toHaveProperty("limit");
      expect(response.body.meta).toHaveProperty("offset");
      expect(response.body.meta).toHaveProperty("count");
      expect(response.body.meta).toHaveProperty("refresh");
      expect(response.body.meta).toHaveProperty("period");
    });

    it("should return data as array in meta response", async () => {
      (leaderboardService.getLeaderboard as any).mockResolvedValueOnce([
        mockLeaderboardEntry,
        mockLeaderboardEntry,
      ]);

      const response = await request(app).get("/api/leaderboard");

      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(2);
    });

    it("should return data as object in user response", async () => {
      (
        leaderboardService.getUserLeaderboardEntry as jest.Mock
      ).mockResolvedValueOnce(mockLeaderboardEntry);

      const response = await request(app).get(
        `/api/leaderboard/user/${mockLeaderboardEntry.stellar_address}`,
      );

      expect(typeof response.body.data).toBe("object");
      expect(Array.isArray(response.body.data)).toBe(false);
    });
  });
});

