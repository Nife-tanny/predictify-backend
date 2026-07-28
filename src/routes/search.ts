import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { logger } from "../config/logger";
import { getRequestId } from "../lib/requestContext";

export const searchRouter = Router();

// In-flight request tracking for graceful shutdown drain
let inFlightSearchRequests = 0;

/**
 * Wait for all in-flight /api/search requests to finish.
 * @param timeoutMs Maximum time to wait before forcing resolution
 */
export async function drainSearchRequests(timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  if (inFlightSearchRequests === 0) {
    logger.info("No in-flight /api/search requests to drain");
    return;
  }

  logger.info({ inFlight: inFlightSearchRequests }, "Draining in-flight /api/search requests...");
  
  while (inFlightSearchRequests > 0) {
    if (Date.now() - start > timeoutMs) {
      logger.warn({ inFlight: inFlightSearchRequests }, "Timeout waiting for /api/search requests to drain");
      break;
    }
    // Poll every 50ms
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (inFlightSearchRequests === 0) {
    logger.info("Successfully drained all /api/search requests");
  }
}

// Stricter edge cases for boundary validation
const searchSchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "Search query must not be empty")
    .max(200, "Search query is too long")
    .refine((s) => !/[\x00-\x1F]/.test(s), "Control characters are not allowed in query"),
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1")
    .max(100, "Limit cannot exceed 100")
    .default(10),
  page: z.coerce
    .number()
    .int()
    .min(1, "Page must be at least 1")
    .default(1),
}).strict(); // Enforce no extra query parameters

searchRouter.get("/", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  inFlightSearchRequests++;
  try {
    const parseResult = searchSchema.safeParse(req.query);
    const reqId = getRequestId() ?? (req as { id?: string }).id ?? "unknown";

    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: "validation_error",
          message: parseResult.error.issues[0]?.message ?? "Invalid search parameters",
          requestId: reqId,
        },
      });
      return;
    }

    const { q, limit, page } = parseResult.data;

    // Structured logging with correlation ID
    logger.info(
      { query: q, limit, page, correlationId: reqId },
      "Processing /api/search request"
    );

    // Mock search delay to simulate DB search and allow testing of the drain mechanism
    await new Promise((resolve) => setTimeout(resolve, 200));

    res.json({
      data: {
        results: [],
        meta: {
          query: q,
          limit,
          page,
          total: 0,
        }
      },
    });
  } catch (e) {
    next(e);
  } finally {
    inFlightSearchRequests--;
  }
});
