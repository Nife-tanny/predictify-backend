import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { idempotencyRecords } from "../db/schema";
import { logger } from "../config/logger";
import { getCorrelationId } from "./correlation";
import { getRequestId } from "../lib/requestContext";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Headers replayed to the client (subset that is safe / useful to repeat). */
const REPLAY_HEADERS = [
  "content-type",
  "content-disposition",
  "location",
  "x-request-id",
  "x-correlation-id",
  "cache-control",
];

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string") return next();

  const correlationId = getCorrelationId() ?? getRequestId() ?? crypto.randomUUID();

  // Key must be a non-empty printable string, max 255 chars.
  if (key.length > 255 || !/^[\x20-\x7E]+$/.test(key)) {
    return res.status(400).json({
      error: {
        code: "invalid_idempotency_key",
        message: "Invalid idempotency key format",
        correlationId,
      },
    });
  }

  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");
  const fingerprint = sha256(body);
  const now = new Date();

  // --- Lookup ---
  const [existing] = await db
    .select()
    .from(idempotencyRecords)
    .where(and(eq(idempotencyRecords.key, key), gt(idempotencyRecords.expiresAt, now)))
    .limit(1);

  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      logger.warn({ correlationId, key, path: req.path }, "idempotency_conflict");
      return res.status(409).json({
        error: {
          code: "idempotency_conflict",
          message: "Idempotency key conflict",
          correlationId,
        },
      });
    }
    // Replay stored response.
    logger.debug({ correlationId, key, path: req.path }, "idempotency_replay");
    const headers = (existing.responseHeaders ?? {}) as Record<string, string>;
    for (const h of REPLAY_HEADERS) {
      if (headers[h]) res.setHeader(h, headers[h]);
    }
    res.setHeader("Idempotent-Replayed", "true");
    res.status(existing.responseStatus);

    const respBody = existing.responseBody;
    if (
      typeof respBody === "object" &&
      respBody !== null &&
      "content" in respBody &&
      typeof (respBody as { content?: unknown }).content === "string"
    ) {
      return res.send((respBody as { content: string }).content);
    }
    if (typeof respBody === "string") {
      return res.send(respBody);
    }
    return res.json(respBody);
  }

  // --- Miss: intercept response so we can persist it ---
  let persisted = false;
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  function saveIdempotency(bodyToSave: unknown) {
    if (persisted) return;
    persisted = true;
    const status = res.statusCode;
    if (status >= 200 && status < 300) {
      const headers: Record<string, string> = {};
      for (const h of REPLAY_HEADERS) {
        const v = res.getHeader(h);
        if (v !== undefined) headers[h] = String(v);
      }
      const expiresAt = new Date(Date.now() + TTL_MS);
      const valBody = typeof bodyToSave === "string" ? { content: bodyToSave } : bodyToSave;
      db.insert(idempotencyRecords)
        .values({
          key,
          fingerprint,
          responseStatus: status,
          responseBody: valBody,
          responseHeaders: headers,
          expiresAt,
        })
        .catch((err) => logger.error({ err, key, correlationId }, "idempotency_persist_failed"));
    }
  }

  res.json = function (body: unknown) {
    saveIdempotency(body);
    return originalJson(body);
  };

  res.send = function (body: unknown) {
    if (typeof body === "string" || Buffer.isBuffer(body)) {
      saveIdempotency(body.toString("utf-8"));
    } else if (typeof body === "object" && body !== null) {
      saveIdempotency(body);
    }
    return originalSend(body as any);
  };

  next();
}

