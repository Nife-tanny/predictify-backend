/**
 * @module auditService
 *
 * Provides structured audit logging for all significant backend actions.
 * Each entry captures the action, actor, request context, and an optional
 * rate-limit decision snapshot for traceability.
 *
 * All entries are persisted to the `audit_logs` table via Drizzle ORM and
 * emitted as structured pino log lines with a correlation ID.
 */

import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import { auditLogs } from "../db/schema";
import { logger } from "../config/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Rate-limit context captured at the point of a request.
 */
export interface RateLimitContext {
  /** Configured maximum requests allowed in the window */
  limit: number;
  /** Remaining requests allowed in the current window */
  remaining: number;
  /** ISO-8601 timestamp when the rate-limit window resets */
  resetAt: string;
  /** Whether this request was blocked (true = 429 returned) */
  blocked: boolean;
}

/**
 * Input shape for creating an audit log entry.
 */
export interface AuditEntryInput {
  /** Action identifier e.g. "auth.login", "market.create", "rate_limit.blocked" */
  action: string;
  /** Stellar wallet address of the actor — omit for unauthenticated requests */
  walletAddress?: string;
  /** IP address of the request origin */
  ip: string;
  /** Correlation ID for cross-log tracing — generated if not provided */
  correlationId?: string;
  /** Optional rate-limit context to enrich the entry */
  rateLimitContext?: RateLimitContext;
  /** The state before the action took place */
  beforeState?: Record<string, unknown> | null;
  /** The state after the action took place */
  afterState?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Persists a structured audit log entry to the database and emits a
 * pino log line at `info` level with the full entry context.
 *
 * Errors are caught and logged at `warn` level — audit failures must never
 * bubble up and break the request lifecycle.
 *
 * @param input - The audit entry data
 * @returns The correlation ID used for this entry
 */
export async function createAuditLog(input: AuditEntryInput): Promise<string> {
  const correlationId = input.correlationId ?? uuidv4();

  const entry = {
    action: input.action,
    walletAddress: input.walletAddress ?? null,
    ip: input.ip,
    correlationId,
    rateLimitContext: input.rateLimitContext ?? null,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
  };

  try {
    await db.insert(auditLogs).values(entry);

    logger.info(
      {
        audit: true,
        correlationId,
        action: entry.action,
        walletAddress: entry.walletAddress,
        ip: entry.ip,
        rateLimitContext: entry.rateLimitContext,
        beforeState: entry.beforeState,
        afterState: entry.afterState,
      },
      "audit_log_created",
    );
  } catch (err) {
    logger.warn(
      { err, correlationId, action: entry.action },
      "audit_log_write_failed",
    );
  }

  return correlationId;
}
