/**
 * /api/predictions — prediction claim flow.
 *
 * All routes require authentication via the `requireAuth` middleware.
 * Idempotency-Key header is supported for the POST /claim mutation via the
 * global idempotency middleware applied in `src/index.ts`.
 */

import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { claimWinnings, ClaimError } from "../services/claimService";
import { logger } from "../config/logger";
import { getRequestId } from "../lib/requestContext";

export const predictionsRouter = Router();

// Apply requireAuth to every route on this router.
predictionsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /api/predictions/claim
// ---------------------------------------------------------------------------

const claimBodySchema = z
  .object({
    marketId: z.string().min(1, "marketId is required"),
  })
  .strict();

/**
 * POST /api/predictions/claim
 *
 * Claims winnings for a winning prediction after the parent market has been
 * resolved.  Builds and submits a Soroban claim transaction, then persists
 * the on-chain tx hash on the prediction row.
 *
 * Request body:
 * ```json
 * { "marketId": "uuid-or-text-id" }
 * ```
 *
 * Idempotent via:
 *   - Internal guard: if claimTxHash is already set, returns existing data.
 *   - HTTP layer: the global idempotency middleware (Idempotency-Key header).
 *
 * Responses:
 *   200 — Claim successful (or previously claimed — idempotent replay).
 *   400 — Market not resolved, prediction not a winner, or validation error.
 *   401 — Missing or invalid Bearer token.
 *   404 — Market or prediction not found.
 *   500 — Soroban transaction submission failed.
 */
predictionsRouter.post("/claim", async (req, res, next) => {
  try {
    const parsed = claimBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "validation_error",
          details: parsed.error.flatten().fieldErrors,
        },
      });
      return;
    }

    const { marketId } = parsed.data;
    const claimUser = (req as unknown as { user: { id: string; stellarAddress: string } }).user;
    const requestId = getRequestId();

    logger.info(
      { reqId: requestId, marketId, userId: claimUser.id },
      "claim: processing claim request",
    );

    const result = await claimWinnings({
      marketId,
      userId: claimUser.id,
      stellarAddress: claimUser.stellarAddress,
    });

    logger.info(
      { reqId: requestId, marketId, userId: claimUser.id, claimTxHash: result.claimTxHash },
      "claim: completed successfully",
    );

    res.status(200).json({ data: result });
  } catch (e) {
    if (e instanceof ClaimError) {
      res.status(e.status).json({ error: { code: e.code, message: e.message } });
      return;
    }
    next(e);
  }
});

