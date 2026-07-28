/**
 * @module captcha
 *
 * Per-IP captcha challenge gate for unauthenticated endpoints.
 *
 * After CAPTCHA_THRESHOLD requests per IP within CAPTCHA_WINDOW_MS,
 * the middleware returns a 429 response with `captcha_required` so the
 * client knows to solve a captcha before retrying.
 *
 * Authenticated callers (Bearer token present) bypass the gate entirely.
 *
 * Configuration (env):
 *   CAPTCHA_THRESHOLD  — requests before challenge is issued (default 10; 0 = disabled)
 *   CAPTCHA_WINDOW_MS  — sliding window length in ms (default 60_000)
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { getRequestId } from "../lib/requestContext";
import { isAuthenticatedRequest, extractClientIp, SlidingWindowStore } from "./rateLimitAnon";

export { SlidingWindowStore };

export interface CaptchaOptions {
  /** Number of requests per IP per window before challenge is issued. 0 = disabled. */
  threshold: number;
  /** Sliding window length in ms. */
  windowMs: number;
  /** When true, client IP is taken from X-Forwarded-For. */
  trustProxy?: boolean;
  /** Optional store instance (for testing). */
  store?: SlidingWindowStore;
}

/**
 * Factory that creates the captcha-gate middleware.
 *
 * @example
 * app.use("/api", createCaptchaGate({ threshold: 10, windowMs: 60_000 }));
 */
export function createCaptchaGate(options: CaptchaOptions): RequestHandler {
  const { threshold, windowMs, trustProxy = false, store = new SlidingWindowStore() } = options;

  // When threshold is 0 the gate is disabled — pass through immediately.
  if (threshold === 0) {
    return (_req: Request, _res: Response, next: NextFunction): void => next();
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    // Authenticated callers are never challenged.
    if (isAuthenticatedRequest(req)) {
      next();
      return;
    }

    const now = Date.now();
    const clientIp = extractClientIp(req, trustProxy);
    const active = store.getTimestamps(clientIp, now, windowMs);

    if (active.length >= threshold) {
      const reqId = getRequestId();
      logger.warn(
        {
          reqId,
          clientIp,
          path: req.path,
          method: req.method,
          threshold,
          windowMs,
          count: active.length,
        },
        "captcha_challenge_required",
      );

      res.status(429).json({
        error: {
          code: "captcha_required",
          message: "Too many requests — please complete a captcha to continue.",
          ...(reqId ? { requestId: reqId } : {}),
        },
      });
      return;
    }

    store.record(clientIp, now, windowMs);
    next();
  };
}

/** Production middleware wired from env defaults. */
export const captchaGate: RequestHandler = createCaptchaGate({
  threshold: env.CAPTCHA_THRESHOLD,
  windowMs: env.CAPTCHA_WINDOW_MS,
  trustProxy: env.TRUST_PROXY,
});
