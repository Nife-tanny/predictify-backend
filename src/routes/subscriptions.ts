import { Router } from "express";
import { db } from "../db/client";
import { webhookSubscriptions } from "../db/schema";
import { conditionalGet } from "../middleware/etag";
import { requireAdmin } from "../middleware/requireAdmin";
import { securityHeaders } from "../middleware/securityHeaders";

export const subscriptionsRouter = Router();

// Mounted first so CSP / X-Content-Type-Options / Referrer-Policy are set
// on every response from this router, including the 403 that requireAdmin
// returns for unauthenticated/unauthorized callers.
subscriptionsRouter.use(securityHeaders);
subscriptionsRouter.use(requireAdmin);

subscriptionsRouter.get("/", async (req, res, next) => {
  try {
    const subscriptions = await db.select().from(webhookSubscriptions);

    if (conditionalGet(subscriptions, req, res)) {
      return;
    }

    res.json({ data: subscriptions });
  } catch (err) {
    next(err);
  }
});
