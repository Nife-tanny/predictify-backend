import { Router } from "express";
import { z } from "zod";
import { logger } from "../config/logger";
import { rateLimitAnon } from "../middleware/rateLimitAnon";
import { getRequestId } from "../lib/requestContext";
import { listMarketComments } from "../services/marketCommentsService";

export const commentsRouter = Router();

// Throttle anonymous read traffic; authenticated Bearer callers bypass.
commentsRouter.use(rateLimitAnon);

const listCommentsQuerySchema = z
    .object({
        limit: z.coerce.number().int().positive().optional(),
        cursor: z.string().min(1).optional(),
    })
    .strict();

const marketIdSchema = z.string().min(1);

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

        const page = await listMarketComments(
            parsedMarketId.data,
            parsedQuery.data.cursor,
            parsedQuery.data.limit,
        );

        logger.info(
            { reqId: requestId, marketId: parsedMarketId.data, returned: page.data.length },
            "market comments listed",
        );

        res.json({ data: page.data, nextCursor: page.nextCursor });
    } catch (e) {
        next(e);
    }
});

import { enforceCors } from "../middleware/cors";

export const commentsRouter = Router();

// Apply CORS allowlist enforcement for this entire route
commentsRouter.use(enforceCors);

commentsRouter.get("/", (req, res) => {
  res.json({
    data: [],
    message: "Comments fetched securely",
  });
});

commentsRouter.post("/", (req, res) => {
  res.status(201).json({
    data: req.body,
    message: "Comment created successfully",
  });
});
