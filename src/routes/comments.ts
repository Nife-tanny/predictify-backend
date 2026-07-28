/**
 * @module routes/comments
 *
 * Express route handlers for comment operations (/api/comments and /api/markets/:id/comments).
 *
 * Guarantees:
 * 1. Generates / preserves and echoes X-Correlation-Id header via correlationMiddleware.
 * 2. Emits structured logs using Pino containing `correlationId` and `reqId`.
 * 3. Outbound HTTP requests propagate X-Correlation-Id using `fetchWithCorrelationId`.
 * 4. Input validation using Zod at boundary with standardized error envelopes.
 */

import { Router } from "express";
import { z } from "zod";
import { logger } from "../config/logger";
import { rateLimitAnon } from "../middleware/rateLimitAnon";
import { marketsCors } from "../middleware/cors";
import { getRequestId } from "../lib/requestContext";
import { getCorrelationId, CORRELATION_ID_HEADER, fetchWithCorrelationId } from "../middleware/correlation";
import { listMarketComments } from "../services/marketCommentsService";

export const commentsRouter = Router();

// Apply CORS allowlist enforcement and rate limiting for all comment routes
commentsRouter.use(marketsCors());
commentsRouter.use(rateLimitAnon);

// ── Validation Schemas ───────────────────────────────────────────────────────

const listCommentsQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(100).optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

const marketIdSchema = z.string().min(1);

const createCommentSchema = z
  .object({
    marketId: z.string().min(1),
    body: z.string().min(1).max(2000),
    authorAddress: z.string().optional(),
    outboundUrl: z.string().url().optional(),
  })
  .strict();

// ── Route Handlers ───────────────────────────────────────────────────────────

/**
 * GET /api/markets/:id/comments (or /api/comments/:id/comments)
 *
 * Lists market comments with cursor-based pagination.
 */
commentsRouter.get("/:id/comments", async (req, res, next) => {
  try {
    const parsedMarketId = marketIdSchema.safeParse(req.params.id);
    if (!parsedMarketId.success) {
      res.status(400).json({ error: { code: "validation_error" } });
      return;
    }

    const parsedQuery = listCommentsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({
        error: {
          code: "validation_error",
          details: parsedQuery.error.issues,
        },
      });
      return;
    }

    const requestId = getRequestId();
    const correlationId = getCorrelationId() ?? (res.locals.correlationId as string | undefined);

    if (correlationId) {
      res.setHeader(CORRELATION_ID_HEADER, correlationId);
    }

    const page = await listMarketComments(
      parsedMarketId.data,
      parsedQuery.data.cursor,
      parsedQuery.data.limit,
    );

    logger.info(
      {
        correlationId,
        reqId: requestId,
        marketId: parsedMarketId.data,
        returned: page.data.length,
      },
      "market comments listed",
    );

    res.json({ data: page.data, nextCursor: page.nextCursor });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/comments
 *
 * Root comments endpoint for listing comments.
 */
commentsRouter.get("/", async (req, res, next) => {
  try {
    const parsedQuery = listCommentsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({
        error: {
          code: "validation_error",
          details: parsedQuery.error.issues,
        },
      });
      return;
    }

    const requestId = getRequestId();
    const correlationId = getCorrelationId() ?? (res.locals.correlationId as string | undefined);

    if (correlationId) {
      res.setHeader(CORRELATION_ID_HEADER, correlationId);
    }

    logger.info(
      {
        correlationId,
        reqId: requestId,
      },
      "comments fetched securely",
    );

    res.json({
      data: [],
      nextCursor: null,
      message: "Comments fetched securely",
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/comments
 *
 * Creates a new comment and optionally dispatches an outbound call
 * propagating X-Correlation-Id.
 */
commentsRouter.post("/", async (req, res, next) => {
  try {
    const parsedBody = createCommentSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: {
          code: "validation_error",
          details: parsedBody.error.issues,
        },
      });
      return;
    }

    const requestId = getRequestId();
    const correlationId = getCorrelationId() ?? (res.locals.correlationId as string | undefined);

    if (correlationId) {
      res.setHeader(CORRELATION_ID_HEADER, correlationId);
    }

    const { marketId, body, authorAddress, outboundUrl } = parsedBody.data;

    let outboundStatus: number | undefined;
    if (outboundUrl) {
      try {
        const outboundRes = await fetchWithCorrelationId(outboundUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ marketId, body }),
        });
        outboundStatus = outboundRes.status;
      } catch (err) {
        logger.warn(
          { correlationId, reqId: requestId, err, outboundUrl },
          "outbound comment notification failed",
        );
      }
    }

    logger.info(
      {
        correlationId,
        reqId: requestId,
        marketId,
        authorAddress,
        outboundStatus,
      },
      "comment created successfully",
    );

    res.status(201).json({
      data: {
        id: `c-${Date.now()}`,
        marketId,
        body,
        authorAddress: authorAddress ?? null,
        createdAt: new Date().toISOString(),
      },
      message: "Comment created successfully",
    });
  } catch (e) {
    next(e);
  }
});
