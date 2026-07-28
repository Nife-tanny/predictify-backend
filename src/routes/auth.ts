import { Router } from "express";
import { conditionalGet } from "../middleware/etag";
import { createPerUserRateLimiter } from "../middleware/rateLimit";
import {
  rotateRefreshToken,
  revokeFamily,
} from "../services/refreshTokenService";
import { createChallenge } from "../services/authChallengeService";
import { verifyChallengeAndIssueJwt } from "../services/authVerifyService";
import { RouteErrorFactory } from "../errors";
import { accessLog } from "../middleware/accessLog";
import { requestTimeout } from "../middleware/timeout";
import { loginRateLimit } from "../middleware/loginRateLimit";
import { authHealthRouter } from "./auth/health";
import {
  authChallengeBodySchema,
  authVerifyBodySchema,
  authRefreshBodySchema,
  authLogoutBodySchema,
  authWalletLogoutBodySchema,
} from "../validators/auth";

export const authRouter = Router();
authRouter.use(accessLog);
authRouter.use(requestTimeout(15000));

// ── Health probe (no auth required) ───────────────────────────────────────
authRouter.use("/health", authHealthRouter);

/**
 * Generate a rate limit key based on stellarAddress (if present) or IP address.
 * This allows per-user rate limiting when the address is known, and per-IP
 * rate limiting as a fallback.
 */
function getAuthRateLimitKey(req: { body?: unknown; socket?: { remoteAddress?: string | null } }): string {
  const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : undefined;
  const stellarAddress = typeof body?.stellarAddress === "string" ? body.stellarAddress.trim() : "";

  if (stellarAddress.length > 0) {
    return `auth:${stellarAddress}`;
  }

  return `ip:${req.socket?.remoteAddress ?? "unknown"}`;
}

authRouter.use(
  createPerUserRateLimiter({
    windowMs: 60 * 1000,
    limit: 5,
    keyGenerator: (req) => getAuthRateLimitKey(req),
  }),
);

/**
 * POST /api/auth/challenge
 *
 * Creates a new authentication challenge (nonce + expiry) for a given Stellar
 * address. The returned nonce must be signed by the user's private key and
 * submitted to /api/auth/verify along with the address and signature.
 *
 * Validation errors (e.g., invalid Stellar address) return 422 with a
 * structured error envelope containing detailed field errors.
 *
 * Rate limit: 5 requests per 60 seconds per address or IP.
 */
authRouter.post("/challenge", loginRateLimit, async (req, res, next) => {
  try {
    const parsed = authChallengeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw RouteErrorFactory.validation(
        "Invalid request body",
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }

    const result = await createChallenge(parsed.data.stellarAddress);
    const payload = {
      nonce: result.nonce,
      expiresAt: result.expiresAt.toISOString(),
    };

    if (conditionalGet(payload, req, res)) return;

    res.status(201).json(payload);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/auth/verify
 *
 * Verifies that the provided signature is a valid Ed25519 signature of the
 * nonce using the private key corresponding to the given Stellar address.
 *
 * On success, returns access and refresh tokens for the authenticated user.
 * On validation failure, returns 422 with structured field errors.
 * On signature verification failure, returns a domain-specific error.
 *
 * Rate limit: 5 requests per 60 seconds per address or IP.
 */
authRouter.post("/verify", loginRateLimit, async (req, res, next) => {
  try {
    const parsed = authVerifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw RouteErrorFactory.validation(
        "Invalid request body",
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }

    const result = await verifyChallengeAndIssueJwt(
      parsed.data.stellarAddress,
      parsed.data.nonce,
      parsed.data.signature,
    );

    if (!result.ok) {
      throw result.error;
    }

    if (conditionalGet(result.value, req, res)) return;

    res.status(200).json(result.value);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/auth/refresh
 *
 * Rotates the refresh token and returns a new access token + refresh token
 * pair. The new refresh token is valid for future rotations; the old one
 * is invalidated, along with all tokens in its family (chain of rotations).
 *
 * Validation errors (e.g., missing or invalid refreshToken) return 422 with
 * a structured error envelope.
 *
 * Rate limit: 5 requests per 60 seconds per IP (no address available).
 */
authRouter.post("/refresh", async (req, res, next) => {
  try {
    const parsed = authRefreshBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw RouteErrorFactory.validation(
        "Invalid request body",
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }

    const result = await rotateRefreshToken(parsed.data.refreshToken);
    if (!result.ok) {
      throw result.error;
    }

    if (conditionalGet(result.value, req, res)) return;

    res.json(result.value);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout
 *
 * Revokes the entire refresh token family (chain of rotations) associated
 * with the provided token, ensuring all descendants of that token are also
 * invalidated. Returns 204 No Content on success.
 *
 * Validation errors (e.g., missing or invalid refreshToken) return 422 with
 * a structured error envelope.
 *
 * Rate limit: 5 requests per 60 seconds per IP.
 */
authRouter.post("/logout", async (req, res, next) => {
  try {
    const parsed = authLogoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw RouteErrorFactory.validation(
        "Invalid request body",
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }

    await revokeFamily(parsed.data.refreshToken);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/wallet/logout
 *
 * Wallet-specific alias for logout. Revokes the entire refresh token family
 * (chain of rotations) associated with the provided token. Returns 204 No
 * Content on success.
 *
 * This endpoint is provided for consistency with client SDKs and naming
 * conventions. Identical behavior to POST /api/auth/logout.
 *
 * Validation errors return 422 with a structured error envelope.
 *
 * Rate limit: 5 requests per 60 seconds per IP.
 */
authRouter.post("/wallet/logout", async (req, res, next) => {
  try {
    const parsed = authWalletLogoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw RouteErrorFactory.validation(
        "Invalid request body",
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }

    await revokeFamily(parsed.data.refreshToken);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
