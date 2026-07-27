import { Router } from "express";
import { getTrending } from "../../services/trendingService";
import { rateLimitAnon } from "../../middleware/rateLimitAnon";
import { trendingQuerySchema } from "../../validators/markets";

export const trendingRouter = Router();

trendingRouter.use(rateLimitAnon);

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
