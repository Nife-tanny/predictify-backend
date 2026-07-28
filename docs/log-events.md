# Market Log Events

Structured, audit-grade log events emitted on every market state change in the Predictify backend.

All events are emitted from the **service layer** (`src/services/*`) so they are captured regardless of entry point (HTTP, indexer worker, queue job).

Downstream consumers: observability dashboards, SIEM, audit pipelines.

---

## Transport

- Logger: **pino** (`src/config/logger.ts`)
- Output: JSON lines (`{"level":30,"time":...,"service":"predictify-backend", ...}`)
- Redaction: `req.headers.authorization`, `req.headers.cookie`, `password`, `token` (pino base redact), plus in-event sanitization for `secret`, `apikey`, `privateKey`, etc.

---

## Correlation IDs

Every market log event includes a `correlationId` field:

1. Explicit `correlationId` passed in the event context
2. Else `X-Request-Id` from `AsyncLocalStorage` (`src/lib/requestContext.ts`)
3. Else generated `UUIDv4` (background workers / indexer)

This allows end-to-end tracing: `HTTP request → service → DB → webhook → indexer`.

Example:
```json
{
  "level": 30,
  "event": "market.resolved",
  "correlationId": "9d8f7c3a-1b2c-4d5e-8f9a-0b1c2d3e4f5a",
  "marketId": "market-sol-100",
  "winningOutcome": "YES",
  "ledger": 99000,
  "timestamp": 1700000000,
  "actor": "indexer",
  "msg": "market:market.resolved",
  "service": "predictify-backend"
}
```

---

## Event Catalogue

### `market.created`
A new prediction market was created.

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | string | Market primary key |
| `correlationId` | string | Trace ID |
| `actor` | string? | Creator (admin address / system) |
| `question` | string? | Initial question |
| `resolutionTime` | string? | ISO timestamp |

**Emitter:** `marketService.createMarket` (future)

---

### `market.updated`
Market metadata/question updated by an admin (optimistic concurrency).

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | string | |
| `correlationId` | string | |
| `actor` | string | Admin Stellar address |
| `version` | number | New version after update |
| `fieldsUpdated` | string[] | e.g. `["question","metadata"]` |

**Emitter:** `src/services/marketService.ts` → `updateMarket()`

---

### `market.resolved`
Market resolved on-chain; predictions categorized won/lost.

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | string | |
| `correlationId` | string | |
| `winningOutcome` | string | Outcome string matching `predictions.outcome` |
| `ledger` | number | Stellar ledger sequence |
| `timestamp` | number | Unix seconds |
| `actor` | string | Always `"indexer"` |

**Emitter:** `src/services/marketResolutionService.ts` → `resolveMarket()`

Idempotent: replays emit no duplicate log (service returns `processed:false`).

---

### `market.disputed`
A user opened a dispute against a market resolution.

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | string | |
| `correlationId` | string | |
| `disputeId` | string | UUID |
| `actor` | string | User ID opening the dispute |
| `reason` | string | Free text, 10–500 chars |
| `evidenceUri` | string \| null | HTTPS URL, SSRF-checked |

**Emitter:** `src/services/disputeService.ts` → `openDispute()`

Also triggers `dispute.opened` webhook.

---

### `market.closed`
Market closed to new predictions (resolutionTime passed / admin close).

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | string | |
| `correlationId` | string | |
| `reason` | string | `"resolution_time_elapsed"` \| `"admin"` |
| `actor` | string? | If admin-closed |

**Emitter:** planned – `marketService.closeMarket()`

---

### `market.archived`
Market archived / hidden from listings.

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | string | |
| `correlationId` | string | |
| `actor` | string | Admin address |
| `archived` | boolean | true/false |

**Emitter:** planned

---

## Security Notes

- **PII redaction:** event payloads are sanitized via `sanitize()` in `src/logging/events.ts`. Keys matching `/secret|password|token|authorization|privatekey|apikey/i` are replaced with `"[REDACTED]"`.
- **No secrets in logs:** webhook HMAC secrets, JWTs, refresh tokens are never logged.
- **Input validation at boundary:** all HTTP routes validate with Zod before calling services (`src/routes/markets.ts`, `src/routes/disputes.ts`).
- **Standardized error envelope:** `{ "error": { "code": "...", "details?": ... } }` – see `docs/errors.md`.
- **Correlation ID propagation:** `X-Request-Id` is sanitized (max 64 chars, `[A-Za-z0-9\-_]+`) in `pinoHttp` middleware.

## Usage (service authors)

```ts
import { emitMarketEvent, LogEvent } from "../logging/events";

emitMarketEvent(LogEvent.MARKET_UPDATED, {
  marketId,
  actor: adminAddress,
  version: newVersion,
  fieldsUpdated: Object.keys(patch),
});
```

- Always include `marketId`.
- Prefer `actor` = Stellar address / userId / `"indexer"` / `"system"`.
- Do not pass secrets; sanitization is a safety net, not a substitute.

## Testing

Run the event tests:

```bash
npm test -- tests/logging.events.test.ts
```

Coverage target: **≥90% on changed lines** (enforced in CI).

Tests verify:
- correlationId resolution (explicit → requestContext → UUID)
- payload sanitization
- enum stability
- service-layer emission

---

## Observability Queries

Loki / Elasticsearch examples:

```
{service="predictify-backend"} | json | event="market.resolved"
{service="predictify-backend"} | json | event=~"market.*" | line_format "{{.correlationId}} {{.event}} {{.marketId}}"
```

Metrics to alert on:
- `rate(market_disputed[5m]) > 5` – dispute spike
- `absent(market_resolved)` for > 1h during active markets – indexer stall
