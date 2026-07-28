/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from "express";
import { getMarketTags } from "../../repositories/marketRepository";
import { rateLimitAnon } from "../../middleware/rateLimitAnon";
import { logger } from "../../config/logger";

export const tagsRouter = Router();

tagsRouter.use(rateLimitAnon);

// GET /api/markets/tags - Get market tags with counts
tagsRouter.get("/", async (req, res, next) => {
  const reqId = String((req as any).id ?? "anon");
  try {
    logger.debug({ reqId, correlationId: reqId }, "Fetching market tags");
    const data = await getMarketTags();
    logger.info({ reqId, correlationId: reqId, count: data.length }, "Market tags fetched successfully");
    res.json({ data });
  } catch (e) {
    logger.error({ reqId, correlationId: reqId, err: e }, "Failed to fetch market tags");
    next(e);
  }
});
