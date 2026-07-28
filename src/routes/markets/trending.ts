import { Router } from "express";
import { z } from "zod";
import { getTrending } from "../../services/trendingService";
import { rateLimitAnon } from "../../middleware/rateLimitAnon";

export const trendingRouter = Router();

trendingRouter.use(rateLimitAnon);

const trendingQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// GET /api/markets/trending - Get trending markets
trendingRouter.get("/", async (req, res, next) => {
  try {
    const { limit, offset } = trendingQuerySchema.parse(req.query);
    const data = await getTrending(limit, offset);
    res.json({ data, meta: { limit, offset, count: data.length } });
  } catch (e) {
    next(e);
  }
});
