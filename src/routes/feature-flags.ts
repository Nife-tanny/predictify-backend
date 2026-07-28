import { Router, type Request, type Response, type NextFunction } from "express";
import { getAllFlags } from "../services/featureFlags";
import { accessLog } from "../middleware/accessLog";
import { featureFlagsQuerySchema } from "../schemas/feature-flags.schema";
import { RouteErrorFactory } from "../errors";
import { paginate, clampLimit, DEFAULT_PAGE_SIZE } from "../utils/cursor";

export const featureFlagsRouter = Router();

// Mount the access log middleware so every request to /api/feature-flags gets logged
featureFlagsRouter.use(accessLog);

/**
 * GET /api/feature-flags
 * Public endpoint returning active feature flag values for the calling user/client.
 *
 * Query parameters:
 *   - cursor  (optional) — opaque base64url token from the previous page's `next_cursor`
 *   - limit   (optional, default 20, max 100) — page size
 *
 * Response:
 *   { items: Array<{ id: string, enabled: boolean, variant: string | null }>, next_cursor: string | null, total: number }
 *
 * Pagination:
 *   `next_cursor` is null on the last page.  Pass it verbatim as `?cursor=` to
 *   fetch the next page.  A missing, tampered, or version-mismatched cursor is
 *   silently treated as absent (restart from page one) rather than 500-ing.
 */
featureFlagsRouter.get("/", (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = featureFlagsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw RouteErrorFactory.validation(
        "Invalid query parameters",
        parseResult.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }

    const { cursor, limit: rawLimit } = parseResult.data;
    const limit = clampLimit(rawLimit, DEFAULT_PAGE_SIZE);

    const flags = getAllFlags();
    const sorted = [...flags].sort((a, b) => b.id.localeCompare(a.id));

    const page = paginate(
      sorted,
      (flag) => ({ sortValue: flag.id, id: flag.id }),
      cursor,
      limit,
    );

    const items = page.data.map((flag) => ({
      id: flag.id,
      enabled: flag.enabled,
      variant: flag.variant ?? null,
    }));

    return res.status(200).json({
      items,
      next_cursor: page.nextCursor,
      total: sorted.length,
    });
  } catch (error) {
    next(error);
  }
});
