import { Router, type Request, type Response, type NextFunction } from "express";
import { getAllFlags } from "../services/featureFlags";
import { accessLog } from "../middleware/accessLog";
import { featureFlagsQuerySchema } from "../schemas/feature-flags.schema";
import { RouteErrorFactory } from "../errors";

export const featureFlagsRouter = Router();

// Mount the access log middleware so every request to /api/feature-flags gets logged
featureFlagsRouter.use(accessLog);

/**
 * GET /api/feature-flags
 * Public endpoint returning active feature flag values for the calling user/client.
 */
featureFlagsRouter.get("/", (req: Request, res: Response, next: NextFunction) => {
  const correlationId = res.locals.correlationId;

  try {
    const parseResult = featureFlagsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw RouteErrorFactory.validation(
        "Invalid query parameters",
        parseResult.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }

    const flags = getAllFlags();

    // Transform array into key-value map format for client consumption
    const flagMap = flags.reduce((acc, flag) => {
      acc[flag.id] = {
        enabled: flag.enabled,
        variant: flag.variant ?? null,
      };
      return acc;
    }, {} as Record<string, { enabled: boolean; variant: string | null }>);

    return res.status(200).json({
      success: true,
      data: flagMap,
      correlationId,
    });
  } catch (error) {
    next(error);
  }
});
