import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import { eq, gt, and } from "drizzle-orm";
import { db } from "../../db";
import { idempotencyRecords } from "../../db/schema";
import { requireAuth } from "../../middleware/requireAuth";
import { logger } from "../../config/logger";
import { getRequestId } from "../../lib/requestContext";
import { AuthenticatedRequest } from "../../middleware/auth";
import {
  getPredictionsStream,
  formatPredictionAsCsv,
} from "../../services/exportService";
import { RouteErrorFactory } from "../../errors";

export const exportsPredictionsRouter = Router();

exportsPredictionsRouter.use(requireAuth);

const exportQuerySchema = z
  .object({
    format: z.enum(["csv", "json"], {
      errorMap: () => ({ message: "Format must be either csv or json" }),
    }),
    startDate: z
      .string()
      .optional()
      .refine((val) => {
        if (!val) return true;
        return !isNaN(Date.parse(val));
      }, "Invalid startDate")
      .transform((val) => (val ? new Date(val) : undefined)),
    endDate: z
      .string()
      .optional()
      .refine((val) => {
        if (!val) return true;
        return !isNaN(Date.parse(val));
      }, "Invalid endDate")
      .transform((val) => (val ? new Date(val) : undefined)),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: "startDate must be before or equal to endDate",
      path: ["startDate"],
    },
  );

async function handleExport(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): Promise<void> {
  const reqId =
    getRequestId() ??
    (typeof (req as { id?: unknown }).id === "string"
      ? (req as { id?: string }).id
      : undefined) ??
    crypto.randomUUID();

  const userId = (req as AuthenticatedRequest).user!.id;

  try {
    const queryData = {
      format: req.query.format ?? req.body?.format,
      startDate: req.query.startDate ?? req.body?.startDate,
      endDate: req.query.endDate ?? req.body?.endDate,
    };
    const parsed = exportQuerySchema.parse(queryData);

    const format = parsed.format;
    const filters = {
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };

    const key = req.headers["idempotency-key"];
    let fingerprint = "";
    if (key !== undefined) {
      if (typeof key !== "string" || key.length > 255 || !/^[\x20-\x7E]+$/.test(key)) {
        throw RouteErrorFactory.badRequest("Invalid idempotency key");
      }

      const fingerprintData = JSON.stringify({
        userId,
        format,
        startDate: filters.startDate?.toISOString(),
        endDate: filters.endDate?.toISOString(),
      });
      fingerprint = crypto.createHash("sha256").update(fingerprintData).digest("hex");

      const now = new Date();
      const [existing] = await db
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.key, key),
            gt(idempotencyRecords.expiresAt, now),
          ),
        )
        .limit(1);

      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          logger.warn(
            { reqId, key, userId },
            "idempotency_conflict_detected",
          );
          throw RouteErrorFactory.conflict("Idempotency key conflict");
        }

        logger.info({ reqId, key, userId }, "idempotency_cache_hit_replay");
        res.setHeader("Idempotent-Replayed", "true");
        const headers = (existing.responseHeaders ?? {}) as Record<string, string>;
        for (const [hk, hv] of Object.entries(headers)) {
          res.setHeader(hk, hv);
        }
        res.status(existing.responseStatus);
        const bodyObj = existing.responseBody as { content: string };
        res.write(bodyObj.content);
        res.end();
        return;
      }
    }

    const contentType =
      format === "csv" ? "text/csv" : "application/json";
    const filename = `predictions-${userId}-${Date.now()}.${format}`;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Transfer-Encoding", "chunked");
    res.status(200);

    const stream = getPredictionsStream(userId, filters, reqId);
    let buffer = "";

    if (format === "csv") {
      const header = "id,marketId,userId,outcome,amount,txHash,status,result,createdAt\n";
      if (key) buffer += header;
      res.write(header);

      for await (const row of stream) {
        const line = formatPredictionAsCsv(row);
        if (key) buffer += line;
        res.write(line);
      }
    } else {
      const start = "[\n";
      if (key) buffer += start;
      res.write(start);

      let isFirst = true;
      for await (const row of stream) {
        const itemStr = (isFirst ? "  " : ",\n  ") + JSON.stringify({
          id: row.id,
          marketId: row.marketId,
          userId: row.userId,
          outcome: row.outcome,
          amount: row.amount,
          txHash: row.txHash,
          status: row.status,
          result: row.result,
          createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        });
        isFirst = false;
        if (key) buffer += itemStr;
        res.write(itemStr);
      }

      const end = "\n]\n";
      if (key) buffer += end;
      res.write(end);
    }

    res.end();

    if (key) {
      const TTL_MS = 24 * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + TTL_MS);
      await db
        .insert(idempotencyRecords)
        .values({
          key,
          fingerprint,
          responseStatus: 200,
          responseBody: { content: buffer },
          responseHeaders: {
            "content-type": contentType,
            "content-disposition": `attachment; filename="${filename}"`,
          },
          expiresAt,
        })
        .catch((err) => {
          logger.error(
            { err, key, reqId },
            "idempotency_persist_failed",
          );
        });
    }
  } catch (error) {
    next(error);
  }
}

exportsPredictionsRouter.get("/", handleExport);
exportsPredictionsRouter.post("/", handleExport);
