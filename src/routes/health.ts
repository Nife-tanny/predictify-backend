import { Router } from "express";
import { createAuditLog } from "../services/auditService";
import { getRequestId } from "../lib/requestContext";

export const healthRouter = Router();

// Mock memory state for demonstration purposes on health state
let currentHealthState = { mode: "active", maintenance: false };

healthRouter.get("/", (_req, res) => {
  res.json({ status: "ok", state: currentHealthState });
});

healthRouter.post("/mutations", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const correlationId = getRequestId();
  const beforeState = { ...currentHealthState };

  // Apply changes from body payload
  currentHealthState = { ...currentHealthState, ...req.body };

  await createAuditLog({
    action: "health.state_mutation",
    ip,
    correlationId,
    beforeState,
    afterState: currentHealthState,
  });

  res.json({ status: "updated", state: currentHealthState });
});
