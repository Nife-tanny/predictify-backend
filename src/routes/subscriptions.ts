import { Router } from "express";
import { db } from "../db/client";
import { webhookSubscriptions } from "../db/schema";
import { conditionalGet } from "../middleware/etag";
import { requireAdmin } from "../middleware/requireAdmin";

export const subscriptionsRouter = Router();

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
