/**
 * Idempotency-Key middleware
 *
 * Flow:
 *  1. If no Idempotency-Key header → pass through (key is optional for non-critical callers).
 *  2. Compute sha256 of the raw request body as the fingerprint.
 *  3. Look up the key in idempotency_records.
 *     - HIT  + matching fingerprint  → replay stored response (short-circuit).
 *     - HIT  + different fingerprint → 409 idempotency_conflict.
 *     - MISS → intercept the outgoing response, persist it, then forward to client.
 */

import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { idempotencyRecords } from "../db/schema";
import { logger } from "../config/logger";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Headers replayed to the client (subset that is safe / useful to repeat). */
const REPLAY_HEADERS = ["content-type", "location", "x-request-id"];

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string") return next();

  // Key must be a non-empty printable string, max 255 chars.
  if (key.length > 255 || !/^[\x20-\x7E]+$/.test(key)) {
    return res.status(400).json({ error: { code: "invalid_idempotency_key" } });
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
      return res.status(409).json({ error: { code: "idempotency_conflict" } });
    }
    // Replay stored response.
    logger.debug({ key }, "idempotency_replay");
    const headers = (existing.responseHeaders ?? {}) as Record<string, string>;
    for (const h of REPLAY_HEADERS) {
      if (headers[h]) res.setHeader(h, headers[h]);
    }
    res.setHeader("Idempotent-Replayed", "true");
    return res.status(existing.responseStatus).send(existing.responseBody ?? undefined);
  }

  // --- Miss: intercept response so we can persist it ---
  const originalSend = res.send.bind(res);

  res.send = function (body?: unknown) {
    const result = originalSend(body);
    const status = res.statusCode;
    const headers: Record<string, string> = {};

    for (const h of REPLAY_HEADERS) {
      const v = res.getHeader(h);
      if (v) headers[h] = String(v);
    }

    // Only cache successful mutations; do not cache client or server errors.
    if (status >= 200 && status < 300) {
      const expiresAt = new Date(Date.now() + TTL_MS);
      db.insert(idempotencyRecords)
        .values({ key, fingerprint, responseStatus: status, responseBody: body, responseHeaders: headers, expiresAt })
        .catch((err) => logger.error({ err, key }, "idempotency_persist_failed"));
    }

    return result;
  };

  next();
}
