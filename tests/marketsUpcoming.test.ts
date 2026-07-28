import request from "supertest";
import { createApp } from "../src/index";
import * as marketService from "../src/services/marketService";

jest.mock("../src/services/marketService", () => ({
  ...jest.requireActual("../src/services/marketService"),
  listUpcomingMarkets: jest.fn(),
}));

const mockListUpcoming = marketService.listUpcomingMarkets as jest.Mock;

describe("GET /api/markets/upcoming", () => {
  afterEach(() => jest.clearAllMocks());

  it("returns the list of upcoming markets", async () => {
    mockListUpcoming.mockResolvedValue([
      {
        id: "mkt-2",
        question: "Will the next block confirm in time?",
        status: "upcoming",
        resolutionTime: "2026-08-01T00:00:00.000Z",
      },
    ]);

    const res = await request(createApp()).get("/api/markets/upcoming");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe("upcoming");
    expect(mockListUpcoming).toHaveBeenCalledWith({ limit: 50 });
  });

  it("passes through a valid limit", async () => {
    mockListUpcoming.mockResolvedValue([]);

    const res = await request(createApp()).get("/api/markets/upcoming?limit=5");

    expect(res.status).toBe(200);
    expect(mockListUpcoming).toHaveBeenCalledWith({ limit: 5 });
  });

  it("rejects an invalid limit with 400", async () => {
    const res = await request(createApp()).get("/api/markets/upcoming?limit=1000");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(mockListUpcoming).not.toHaveBeenCalled();
  });
});
