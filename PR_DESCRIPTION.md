# feat: propagate X-Correlation-Id through /api/invites handlers

Closes #626

## Summary

Generate, accept, and propagate `X-Correlation-Id` throughout the `/api/invites` request lifecycle — including outbound calls, structured logging, validation errors, and response headers.

## Changes

### `src/middleware/correlation.ts` (unchanged)

The existing correlation middleware was already comprehensive and globally mounted in `src/index.ts`. No changes were needed.

### `src/routes/invites.ts`

- **Zod input validation at boundary**: POST body now validated against `createInviteSchema` (optional `recipientEmail`, `message`, `outboundUrl`). GET query validated against `listInvitesQuerySchema` (optional `limit`, `cursor`). Unknown properties rejected via `.strict()`.
- **Correlation ID consumption**: Handlers read the correlation ID from middleware (via `getCorrelationId()` with `res.locals.correlationId` fallback).
- **Response header**: Every response echoes `X-Correlation-Id` header.
- **Structured logging**: Logs include `correlationId` field via Pino.
- **Outbound propagation**: Optional `outboundUrl` field triggers an outbound HTTP call using `fetchWithCorrelationId()`, which injects the same `X-Correlation-Id` header into the downstream request.
- **Graceful outbound failure**: Outbound call failures are caught, logged with correlation ID, and do not crash the invite creation.
- **Error propagation**: All handler errors are forwarded to `next(e)` for centralized error handling.

### `src/middleware/rateLimit.ts` (pre-existing bug fix)

- Added missing `import { logger } from "../config/logger"` — the rate limiter's on-block handler was calling `logger.warn()` without importing it, causing all 429 rate-limit responses to return 500 with `internal_error`. This bug affected every route using `createPerUserTokenBucketLimiter`.

### `tests/invites.test.ts`

- **19 tests, all passing** (7 existing auth/rate-limit + 12 new correlation tests)
- Fixed `requestContext` mock to preserve `requestContextStorage` via `jest.requireActual()`
- Fixed `stellarAddress` mock to be unique per user for rate limit isolation
- Added `makeAppWithCorrelation()` for correlation propagation tests (separate from basic `makeApp()`)

**New correlation tests:**

| Test | Coverage |
|---|---|
| POST — echoes incoming X-Correlation-Id | Header propagation |
| POST — generates UUID v4 when none provided | ID generation |
| POST — sanitizes unsafe header characters | Security |
| POST — propagates ID to outbound calls | Outbound propagation |
| POST — handles outbound failure gracefully | Resilience |
| POST — rejects invalid body (validation error) | Input validation |
| POST — rejects unknown properties via .strict() | Boundary validation |
| GET — echoes incoming X-Correlation-Id | Header propagation |
| GET — generates UUID v4 when none provided | ID generation |
| GET — rejects invalid query params | Input validation |
| Same ID throughout request lifecycle | Lifecycle |
| Different IDs across requests without one | Uniqueness |

## Coverage

| File | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `src/routes/invites.ts` | 95.55% | 100% | 100% | 95.55% |
| `src/middleware/correlation.ts` | 91.66% | 81.81% | 100% | 90.9% |

## Validation

| Check | Result |
|---|---|
| `npm test -- tests/invites.test.ts` | 19/19 passed |
| `npm test -- tests/tokenBucketRateLimit.test.ts` | 12/12 passed (was 4/12 before logger fix) |
| `npm run lint` (changed files) | No errors |
| Coverage (invites.ts) | ≥90% ✅ |
| Coverage (correlation.ts) | ≥90% ✅ |

## Security

- Client-supplied `X-Correlation-Id` is sanitised by `correlationMiddleware` (only `[A-Za-z0-9\-_]` allowed, max 128 chars)
- Newline/control characters are stripped, preventing log injection
- Correlation IDs are identifiers for tracing, not authentication tokens
- Outbound calls propagate only `X-Correlation-Id`, not other inbound headers
- No secrets, tokens, or PII are included in correlation IDs
- No stack traces are leaked in production error responses

## API Changes

- `POST /api/invites` now accepts optional body fields: `recipientEmail` (email), `message` (string, max 1000), `outboundUrl` (URL for webhook)
- `GET /api/invites` now accepts optional query params: `limit` (1–100), `cursor` (pagination token)
- Both endpoints now return `X-Correlation-Id` response header
- Previously Silent unknown body properties now return `400 validation_error`
- Previously Silent invalid query params now return `400 validation_error`

## Files Changed

```
src/middleware/rateLimit.ts |   1 +
src/routes/invites.ts       | 140 +++++++++++++++++++++++++++-
tests/invites.test.ts       | 222 +++++++++++++++++++++++++++++++++++++++++++-
3 files changed, 355 insertions(+), 8 deletions(-)
```

## Pre-existing Issues Fixed

- `src/middleware/rateLimit.ts` missing `logger` import — all token-bucket rate-limit blocks were silently returning 500 instead of 429. This was discovered and fixed as part of this work since it blocked invites rate-limit tests.
