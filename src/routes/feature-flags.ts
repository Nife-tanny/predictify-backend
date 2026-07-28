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
import { requestTimeout, abortableRace, RequestAbortedError } from "../middleware/timeout";
import { logger } from "../config/logger";

/** Hard deadline for the flags lookup. Callers receive 504 on breach. */
const FEATURE_FLAGS_TIMEOUT_MS = 5000;

export const featureFlagsRouter = Router();

// ── Per-router timeout middleware ─────────────────────────────────────────────
//
// Sets up an AbortController whose signal is stored on `res.locals.abortSignal`
// and fires a 504 response if the handler hasn't finished within the deadline.
// The route handler opts-in to cooperative cancellation via `abortableRace`.

featureFlagsRouter.use(
  requestTimeout(FEATURE_FLAGS_TIMEOUT_MS, {
    statusCode: 504,
    code: "gateway_timeout",
    message: "Feature-flags request timed out",
  }),
);

// ── GET /api/feature-flags ────────────────────────────────────────────────────

featureFlagsRouter.get("/", async (req, res, next) => {
  // The signal is set by requestTimeout above; may be undefined in isolated
  // unit tests that mount the handler directly without the middleware.
  const signal = res.locals.abortSignal as AbortSignal | undefined;
  const correlationId = (res.locals.correlationId as string | undefined) ?? "unknown";

  // Validate query parameters at the boundary — unknown keys are stripped,
  // invalid enum values produce a 400 via the global error handler.
  const parsed = featureFlagsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid query parameters",
        requestId: correlationId,
      },
    });
    return;
  }

  const { environment, clientVersion } = parsed.data;

  try {
    // getFlagsForUser is synchronous in the current implementation, but we
    // wrap it in abortableRace so that:
    //   a) Future async implementations are automatically timeout-safe.
    //   b) The handler correctly abandons work when the signal fires.
    const flags = await abortableRace(
      Promise.resolve(FeatureFlagsService.getFlagsForUser()),
      signal,
    );

    logger.info(
      { correlationId, environment, clientVersion, path: req.path },
      "feature_flags_fetched",
    );

    res.status(200).json({
      data: flags,
      correlationId,
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
