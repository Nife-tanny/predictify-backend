/**
 * dependencies.ts
 *
 * GET /healthz/dependencies
 *
 * Probes all external dependencies (Postgres, Soroban RPC, Horizon, webhook queue).
 * Returns per-system health details with a composite status.
 *
 * Responses:
 * - 200 OK: All dependencies healthy
 * - 207 Multi-Status: Some dependencies degraded
 * - 503 Service Unavailable: One or more dependencies down
 *
 * Response is cached for 5 seconds to prevent probe storms.
 * Does NOT require authentication — but should be network-restricted in production.
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import {
  getCachedDependencyHealth,
  computeCompositeStatus,
} from "../../services/healthProbes";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const correlationId =
    (req.headers["x-correlation-id"] as string) ?? randomUUID();

  const health = await getCachedDependencyHealth();
  const composite = computeCompositeStatus(health);

  const httpStatus =
    composite === "ok" ? 200 : composite === "degraded" ? 207 : 503;

  res.status(httpStatus).json({
    status: composite,
    correlationId,
    checkedAt: new Date().toISOString(),
    dependencies: health,
  });
});

export default router;
