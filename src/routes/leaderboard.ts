import { Router } from "express";
import { z } from "zod";
import { getLeaderboard, getLeaderboardWithRefresh, getUserLeaderboardEntry } from "../services/leaderboardService";
import { rateLimitAnon } from "../middleware/rateLimitAnon";
import { RouteErrorFactory } from "../errors";
import { abortableRace, requestTimeout, RequestAbortedError } from "../middleware/timeout";
import { logger } from "../config/logger";

export const leaderboardRouter = Router();

/**
 * Leaderboard reads hit a materialized view (and optionally trigger a
 * synchronous REFRESH via `?refresh=true`), so a slow/locked view can hang
 * the request far longer than a normal read. Bound it and fail with a 504
 * rather than tying up the connection indefinitely.
 */
const LEADERBOARD_TIMEOUT_MS = 5000;

leaderboardRouter.use(rateLimitAnon);
leaderboardRouter.use(
  requestTimeout(LEADERBOARD_TIMEOUT_MS, {
    statusCode: 504,
    code: "gateway_timeout",
    message: "Leaderboard request timed out",
  }),
);

export enum LeaderboardPeriod {
  ALL_TIME = "all-time",
  MONTHLY = "monthly",
  WEEKLY = "weekly",
}

const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  refresh: z.coerce.boolean().default(false),
  period: z.nativeEnum(LeaderboardPeriod).default(LeaderboardPeriod.ALL_TIME),
});

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

leaderboardRouter.get("/", async (req, res, next) => {
  const signal = res.locals.abortSignal as AbortSignal | undefined;
  try {
    const { limit, offset, refresh, period } = leaderboardQuerySchema.parse(req.query);

    const fetch = refresh
      ? getLeaderboardWithRefresh(limit, offset, period)
      : getLeaderboard(limit, offset, period);
    const data = await abortableRace(fetch, signal);

    res.json({
      data,
      meta: {
        limit,
        offset,
        count: data.length,
        refresh,
        period,
      }
    });
  } catch (e) {
    if (e instanceof RequestAbortedError) {
      // The timeout middleware already sent (or the client already dropped)
      // the response; just stop working and log for observability.
      logger.warn(
        { correlationId: res.locals.correlationId, path: req.path },
        "Abandoned /api/leaderboard request after timeout",
      );
      return;
    }
    next(e);
  }
});

leaderboardRouter.get("/user/:stellarAddress", async (req, res, next) => {
  const signal = res.locals.abortSignal as AbortSignal | undefined;
  try {
    const { period } = z.object({
      period: z.nativeEnum(LeaderboardPeriod).default(LeaderboardPeriod.ALL_TIME),
    }).parse(req.query);

    const entry = await abortableRace(getUserLeaderboardEntry(req.params.stellarAddress, period), signal);
    if (!entry) {
      throw RouteErrorFactory.notFound("Leaderboard entry not found");
    }
    res.json({ data: entry });
  } catch (e) {
    if (e instanceof RequestAbortedError) {
      logger.warn(
        { correlationId: res.locals.correlationId, path: req.path },
        "Abandoned /api/leaderboard/user request after timeout",
      );
      return;
    }
    next(e);
  }
});
