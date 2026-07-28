/**
 * src/routes/exports.ts
 *
 * Parent router for all export-related endpoints at /api/exports.
 *
 * Applies authentication and per-user token-bucket rate limiting to every
 * export sub-route. Supports Idempotency-Key handling on mutations (POST/PATCH).
 *
 * Sub-routes:
 * ──────────
 * /api/exports/predictions — Prediction history data export (CSV or JSON)
 * /api/exports             — Prediction history export (default alias)
 */

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { createPerUserTokenBucketLimiter } from "../middleware/rateLimit";
import { exportsPredictionsRouter } from "./exports/predictions";

export interface ExportsRouterOptions {
  rateLimit?: {
    capacity?: number;
    refillWindowMs?: number;
  };
}

export function createExportsRouter(options: ExportsRouterOptions = {}): Router {
  const router = Router();

  router.use(requireAuth);
  router.use(
    createPerUserTokenBucketLimiter({
      capacity: options.rateLimit?.capacity ?? 60,
      refillWindowMs: options.rateLimit?.refillWindowMs ?? 60 * 1000,
    }),
  );

  router.use("/predictions", exportsPredictionsRouter);
  router.use("/", exportsPredictionsRouter);

  return router;
}

export const exportsRouter = createExportsRouter();
