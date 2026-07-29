import { Router } from "express";
import { db } from "../db/client";
import { webhookSubscriptions } from "../db/schema";
import { conditionalGet } from "../middleware/etag";
import { requireAdmin } from "../middleware/requireAdmin";
import { eq } from "drizzle-orm";
import { getRequestId } from "../lib/requestContext";
import { createAuditLog } from "../services/auditService";

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

// Create
subscriptionsRouter.post("/", async (req, res, next) => {
  const reqId = getRequestId();
  try {
    const { url, events, active = true } = req.body ?? {};

    const [row] = await db.insert(webhookSubscriptions).values({ url, events, active }).returning();

    // Audit the creation
    void createAuditLog({
      action: "admin.subscription.create",
      walletAddress: req.adminAddress,
      ip: req.ip,
      correlationId: reqId,
      beforeState: null,
      afterState: row,
    });

    return res.status(201).json({ data: row });
  } catch (err) {
    return next(err);
  }
});

// Update
subscriptionsRouter.patch("/:id", async (req, res, next) => {
  const reqId = getRequestId();
  try {
    const id = req.params.id;

    const [existing] = await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));

    if (!existing) {
      return res.status(404).json({ error: { code: "not_found" } });
    }

    const [updated] = await db.update(webhookSubscriptions).set({ ...req.body, updatedAt: new Date() }).where(eq(webhookSubscriptions.id, id)).returning();

    void createAuditLog({
      action: "admin.subscription.update",
      walletAddress: req.adminAddress,
      ip: req.ip,
      correlationId: reqId,
      beforeState: existing,
      afterState: updated,
    });

    return res.json({ data: updated });
  } catch (err) {
    return next(err);
  }
});

// Delete
subscriptionsRouter.delete("/:id", async (req, res, next) => {
  const reqId = getRequestId();
  try {
    const id = req.params.id;

    const [existing] = await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));

    if (!existing) {
      return res.status(404).json({ error: { code: "not_found" } });
    }

    const result = await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));

    void createAuditLog({
      action: "admin.subscription.delete",
      walletAddress: req.adminAddress,
      ip: req.ip,
      correlationId: reqId,
      beforeState: existing,
      afterState: null,
    });

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});
