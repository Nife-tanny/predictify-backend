import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { createPerUserTokenBucketLimiter } from "../middleware/rateLimit";
import { env } from "../config/env";

export interface InvitesRouterOptions {
  rateLimit?: {
    capacity?: number;
    refillWindowMs?: number;
  };
}

export function createInvitesRouter(options: InvitesRouterOptions = {}): Router {
  const router = Router();

  router.use(requireAuth);
  router.use(
    createPerUserTokenBucketLimiter({
      capacity: options.rateLimit?.capacity ?? env.INVITES_RATE_LIMIT_CAPACITY,
      refillWindowMs: options.rateLimit?.refillWindowMs ?? env.INVITES_RATE_LIMIT_WINDOW_MS,
    }),
  );

  router.post("/", (_req: Request, res: Response, _next: NextFunction) => {
    res.status(201).json({ data: { message: "Invite created" } });
  });

  router.get("/", (_req: Request, res: Response, _next: NextFunction) => {
    res.json({ data: [] });
  });

  return router;
}

export const invitesRouter = createInvitesRouter();