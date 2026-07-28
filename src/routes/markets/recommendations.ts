import { Router } from "express";
import { getRecommendedMarkets } from "../../services/marketService";
import { requireAuth } from "../../middleware/requireAuth";
import { logger } from "../../config/logger";
import { AuthenticatedRequest } from "../../middleware/auth";

export const recommendationsRouter = Router();

type RequestWithId = AuthenticatedRequest & { id?: string };

recommendationsRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  const reqId = String((req as RequestWithId).id ?? "anon");
  try {
    const userId = req.user!.id;
    logger.info({ reqId, correlationId: reqId, userId }, "markets_recommendations_requested");

    const recommendations = await getRecommendedMarkets(userId);

    return res.status(200).json({
      data: recommendations,
    });
  } catch (err) {
    logger.error({ reqId, correlationId: reqId, err }, "markets_recommendations_failed");
    return next(err);
  }
});
