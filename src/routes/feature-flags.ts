/**
 * @module routes/feature-flags
 *
 * Public read endpoint for feature flags.
 *
 * GET /api/feature-flags
 *
 * Returns the active feature-flag state suitable for client consumption. The
 * handler is guarded by a per-request timeout; if the backing service doesn't
 * resolve within FEATURE_FLAGS_TIMEOUT_MS the request is cancelled
 * cooperatively (via AbortSignal) and the caller receives:
 *
 *   HTTP 504  { error: { code: "gateway_timeout", message: "...", requestId } }
 *
 * Query parameters (all optional, validated with zod):
 *   environment   – "development" | "testnet" | "mainnet"
 *   clientVersion – arbitrary semver / build string forwarded to the service
 *
 * Response shape on success:
 *   HTTP 200  { data: { FLAG_KEY: { enabled: boolean, metadata?: object }, ... },
 *               correlationId: string }
 */

import { Router } from "express";
import { FeatureFlagsService } from "../services/feature-flags.service";
import { featureFlagsQuerySchema } from "../schemas/feature-flags.schema";
import { RouteErrorFactory } from "../errors";
import { paginate, clampLimit, DEFAULT_PAGE_SIZE } from "../utils/cursor";

export const featureFlagsRouter = Router();

// ── Per-router timeout middleware ─────────────────────────────────────────────
//
// Sets up an AbortController whose signal is stored on `res.locals.abortSignal`
// and fires a 504 response if the handler hasn't finished within the deadline.
// The route handler opts-in to cooperative cancellation via `abortableRace`.

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
    // getFlagsForUser is synchronous in the current implementation, but we
    // wrap it in abortableRace so that:
    //   a) Future async implementations are automatically timeout-safe.
    //   b) The handler correctly abandons work when the signal fires.
    const flags = await abortableRace(
      Promise.resolve(FeatureFlagsService.getFlagsForUser()),
      signal,
    );

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
  } catch (e) {
    if (e instanceof RequestAbortedError) {
      // The timeout middleware has already sent a 504. Just stop working and
      // emit an observability breadcrumb so dashboards can track abandoned
      // requests by path and correlationId.
      logger.warn(
        { correlationId, path: req.path },
        "Abandoned /api/feature-flags request after timeout",
      );
      return;
    }
    next(e);
  }
});
