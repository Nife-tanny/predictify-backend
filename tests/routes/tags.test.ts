import request from "supertest";
import express from "express";
import { tagsRouter } from "../../src/routes/tags";
import { closeAuthPool } from "../../src/middleware/requireAuth";
import { getMarketTags } from "../../src/repositories/marketRepository";
import { errorHandler } from "../../src/middleware/errorHandler";

jest.mock("../../src/repositories/marketRepository");
describe("Tags API", () => {
  let app: any;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/api/tags", tagsRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.resetAllMocks();
    (getMarketTags as jest.Mock).mockResolvedValue([
      { tag: "stellar", count: 10 },
      { tag: "wave", count: 5 },
      { tag: "fwc26", count: 2 },
    ]);
  });

  afterAll(async () => {
    await closeAuthPool();
  });

  it("should return a list of tags", async () => {
    const res = await request(app).get("/api/tags");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tags: ["stellar", "wave", "fwc26"] });
  });

  it("should respect the limit query parameter", async () => {
    const res = await request(app).get("/api/tags?limit=2");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tags: ["stellar", "wave"] });
  });

  it("should return 400 for invalid limit", async () => {
    const res = await request(app).get("/api/tags?limit=invalid");
    expect(res.status).toBe(400);
    // Zod validation error is handled by errorHandler
    expect(res.body).toHaveProperty("error.code", "validation_error");
  });

  it("should return 400 for limit out of bounds", async () => {
    const res = await request(app).get("/api/tags?limit=200");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error.code", "validation_error");
  });

  it("should return X-Correlation-Id header from accessLog middleware", async () => {
    const res = await request(app)
      .get("/api/tags")
      .set("X-Correlation-Id", "test-corr-123");
    expect(res.status).toBe(200);
    expect(res.headers["x-correlation-id"]).toBe("test-corr-123");
  });

  it("should generate a correlation ID when none is supplied", async () => {
    const res = await request(app).get("/api/tags");
    expect(res.status).toBe(200);
    expect(res.headers["x-correlation-id"]).toBeDefined();
    expect(res.headers["x-correlation-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
