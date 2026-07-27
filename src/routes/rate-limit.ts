import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/requireAdmin";
import { getAuditLogs } from "../repositories/auditLogRepo";
import { getRequestId } from "../lib/requestContext";
import { logger } from "../config/logger";
import { rateLimitStatusRouter } from "./rate-limit/status";

export const rateLimitRouter = Router();

const rateLimitQuerySchema = z.object({
  cursor: z.string().min(1, { message: "cursor must not be empty when provided" }).optional(),
  limit: z
    .string()
    .regex(/^\d+$/, { message: "limit must be a positive integer" })
    .optional(),
});

rateLimitRouter.use(rateLimitStatusRouter);

rateLimitRouter.get("/", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  const reqId = getRequestId();

  try {
    const parsed = rateLimitQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      logger.warn(
        {
          reqId,
          adminAddress: req.adminAddress,
          issues: parsed.error.issues,
        },
        "rate_limit_list_validation_failed",
      );

      return res.status(400).json({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "invalid query parameters",
          requestId: reqId,
        },
      });
    }

    const limit = parsed.data.limit ? Number.parseInt(parsed.data.limit, 10) : undefined;
    const page = await getAuditLogs({
      action: "rate_limit.blocked",
      cursor: parsed.data.cursor,
      limit,
    });

    logger.info(
      {
        reqId,
        adminAddress: req.adminAddress,
        count: page.data.length,
        hasNext: page.nextCursor !== null,
      },
      "rate_limit_listed",
    );

    return res.json({
      data: page.data,
      nextCursor: page.nextCursor,
    });
  } catch (err) {
    return next(err);
  }
});
