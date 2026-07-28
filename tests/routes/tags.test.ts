import request from "supertest";
import express from "express";
import { tagsRouter } from "../../src/routes/tags";
import { closeAuthPool } from "../../src/middleware/requireAuth";

describe("Tags API", () => {
  let app: any;

  beforeAll(() => {
    app = express();
    app.use("/api/tags", tagsRouter);
  });

  afterAll(async () => {
    // Clean up auth pool to avoid hanging tests
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
    expect(res.body).toHaveProperty("error.code", "invalid_input");
  });

  it("should return 400 for limit out of bounds", async () => {
    const res = await request(app).get("/api/tags?limit=200");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error.code", "invalid_input");
  });
});
