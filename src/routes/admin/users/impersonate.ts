import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireAdmin } from "../../../middleware/requireAdmin";
import { signAccessToken } from "../../../services/jwtService";
import { createAuditLog } from "../../../services/auditService";
import { getRequestId } from "../../../lib/requestContext";
import { logger } from "../../../config/logger";
import { db } from "../../../db/client";
import { adminAuditLog } from "../../../db/schema";

export interface AdminImpersonateRouterOptions {
  /** Requests per minute per admin token. Default: 60 */
  rateLimitPerMinute?: number;
}

const paramsSchema = z.object({
  address: z.string().trim().min(1),
});

export function createAdminImpersonateRouter(
  opts: AdminImpersonateRouterOptions = {},
): Router {
  const router = Router();
  const limit = opts.rateLimitPerMinute ?? 60;

  router.use(
    rateLimit({
      windowMs: 60_000,
      limit,
      keyGenerator: (req) =>
        (req.headers.authorization as string | undefined) ?? req.ip ?? "unknown",
      standardHeaders: "draft-6",
      legacyHeaders: false,
      message: { error: { code: "rate_limit_exceeded" } },
    }),
  );

  router.use(requireAdmin);

  router.post("/:address/impersonate", async (req, res, next) => {
    try {
      const parsed = paramsSchema.safeParse(req.params);
      const reqId = getRequestId() ?? (req as { id?: string }).id ?? "unknown";

      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: "validation_error",
            details: parsed.error.issues,
            requestId: reqId,
          },
        });
        return;
      }

      const targetAddress = parsed.data.address;
      const adminAddress = req.adminAddress!;

      // 1. Audit log in global auditLogs
      await createAuditLog({
        action: "admin.impersonate",
        walletAddress: adminAddress,
        ip: req.ip ?? "unknown",
        correlationId: reqId,
      });

      // 2. Audit log in adminAuditLog specific to target address
      await db.insert(adminAuditLog).values({
        adminAddress,
        action: "impersonate",
        targetAddress,
      });

      // 3. Structured logging with correlation IDs
      logger.info(
        {
          adminAddress,
          targetAddress,
          correlationId: reqId,
        },
        "Admin impersonated user",
      );

      // 4. Generate token
      const token = signAccessToken({ sub: targetAddress, role: "user" });

      res.status(200).json({
        data: {
          token,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const adminImpersonateRouter = createAdminImpersonateRouter();
