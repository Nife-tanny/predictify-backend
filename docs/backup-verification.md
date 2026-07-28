# Automated Database Backup Verification

Implements issue #151 — nightly job that restores the latest Postgres dump into
an ephemeral database, runs a 10-row smoke test across key tables, and reports
the outcome to Slack.

## Overview

| Area | File | Purpose |
| --- | --- | --- |
| Worker | `src/workers/backupVerifier.ts` | Core verification logic (restore → smoke → Slack) |
| Tests  | `tests/backupVerifier.test.ts`  | Full unit-test suite (90%+ coverage, no live DB) |
| Docs   | `docs/backup-verification.md`   | This file |

---

## How it works

```
┌──────────────────────────────────────────────────┐
│  BackupVerifier.run()                            │
│                                                  │
│  1. pg_restore latest.dump → ephemeral DB        │
│     └─ fail fast on any pg_restore error         │
│                                                  │
│  2. Smoke tests (10 tables)                      │
│     for each table:                              │
│       SELECT COUNT(*) ≥ 1 row                    │
│       timeout: BACKUP_SMOKE_TIMEOUT_MS (15 s)    │
│       fail fast on first query error             │
│                                                  │
│  3. Report outcome → Slack (Block Kit message)   │
│     └─ skip if BACKUP_SLACK_WEBHOOK_URL not set  │
│     └─ Slack failures never mask real errors     │
└──────────────────────────────────────────────────┘
```

### Smoke-tested tables

The following 10 tables are checked (each must have ≥ 1 row):

| Table | Description |
| --- | --- |
| `users` | Registered Stellar wallet owners |
| `markets` | On-chain prediction markets |
| `predictions` | User predictions on markets |
| `webhook_subscriptions` | Registered event delivery endpoints |
| `webhook_deliveries` | Delivery attempts queue |
| `indexer_cursor` | Soroban indexer position cursor |
| `auth_challenges` | Wallet-challenge nonces |
| `refresh_tokens` | JWT refresh token records |
| `idempotency_records` | POST/PATCH idempotency keys |
| `audit_logs` | Action audit trail |

---

## Environment variables

Add these to your `.env` (see `.env.example` for the full list):

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BACKUP_DUMP_PATH` | ✅ | — | Absolute path to the `pg_dump` file to restore (e.g. `/backups/latest.dump`) |
| `BACKUP_EPHEMERAL_DB_URL` | ✅ | — | Connection string for the throwaway Postgres database (e.g. `postgres://user:pass@host:5433/eph_verify`) |
| `BACKUP_SLACK_WEBHOOK_URL` | ❌ | — | Slack Incoming Webhook URL. If absent, Slack reporting is skipped. |
| `BACKUP_SMOKE_TIMEOUT_MS` | ❌ | `15000` | Max milliseconds to wait for each smoke-test query before failing. |

> **Security note:** `BACKUP_EPHEMERAL_DB_URL` contains credentials. Never commit
> this value to source control. Use environment-specific secrets management
> (AWS Secrets Manager, Vault, etc.) in production. The worker passes the
> password as `PGPASSWORD` in the `pg_restore` child process rather than via
> the connection string argument, so it does not appear in the OS process list.

---

## Running the worker

### Standalone (one-shot)

```bash
# Set required env vars first (or source .env):
export BACKUP_DUMP_PATH=/backups/predictify_latest.dump
export BACKUP_EPHEMERAL_DB_URL=postgres://postgres:postgres@localhost:5433/predictify_verify
export BACKUP_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

ts-node src/workers/backupVerifier.ts
```

Exits with code `0` on success, `1` on any failure.

### Nightly cron (recommended)

Add a cron entry (or CI scheduled workflow) that:

1. Downloads / mounts the latest backup file.
2. Ensures the ephemeral database exists and is empty (`DROP … CREATE …`).
3. Runs the worker.

Example GitHub Actions schedule (runs at 02:30 UTC every night):

```yaml
on:
  schedule:
    - cron: "30 2 * * *"

jobs:
  verify-backup:
    runs-on: ubuntu-latest
    services:
      ephemeral-pg:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: predictify_verify
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports:
          - 5433:5432
        options: --health-cmd pg_isready --health-interval 10s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
      - run: npm ci
      - name: Download latest backup
        run: |
          # Replace with your actual backup download step:
          aws s3 cp s3://your-bucket/latest.dump /tmp/latest.dump
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      - name: Run backup verification
        run: npx ts-node src/workers/backupVerifier.ts
        env:
          BACKUP_DUMP_PATH: /tmp/latest.dump
          BACKUP_EPHEMERAL_DB_URL: postgres://postgres:postgres@localhost:5433/predictify_verify
          BACKUP_SLACK_WEBHOOK_URL: ${{ secrets.BACKUP_SLACK_WEBHOOK_URL }}
          # Required by env.ts (not used by verifier, but parsed at import time):
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/predictify
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
          SOROBAN_RPC_URL: https://soroban-testnet.stellar.org
          HORIZON_URL: https://horizon-testnet.stellar.org
          PREDICTIFY_CONTRACT_ID: ${{ secrets.PREDICTIFY_CONTRACT_ID }}
```

### Programmatic (from another module)

```typescript
import { BackupVerifier, type BackupVerifierConfig } from './workers/backupVerifier';

const config: BackupVerifierConfig = {
  BACKUP_DUMP_PATH: '/backups/latest.dump',
  BACKUP_EPHEMERAL_DB_URL: process.env.BACKUP_EPHEMERAL_DB_URL!,
  BACKUP_SLACK_WEBHOOK_URL: process.env.BACKUP_SLACK_WEBHOOK_URL,
  BACKUP_SMOKE_TIMEOUT_MS: 15_000,
};

const verifier = new BackupVerifier(config);
const result = await verifier.run();

if (!result.success) {
  console.error('Backup verification failed:', result.error);
  process.exit(1);
}
```

---

## Slack notification format

When `BACKUP_SLACK_WEBHOOK_URL` is configured, the worker sends a structured
[Block Kit](https://api.slack.com/block-kit) message:

**Success example:**

```
✅ Predictify Backup Verification — PASSED
─────────────────────────────────────────
Run ID   │ 3fa85f64-5717-4562-b3fc-2c963f66afa6
Duration │ 8 432ms
Smoke    │ 10/10 passed
Finished │ 2026-06-28T02:31:04.000Z

Table row counts
✓ `users`                 — 312 row(s) (min 1)
✓ `markets`               — 47 row(s)  (min 1)
...
```

**Failure example:**

```
❌ Predictify Backup Verification — FAILED
─────────────────────────────────────────
Run ID   │ 7c9e6679-7425-40de-944b-e07fc1f90ae7
Duration │ 3 201ms
Smoke    │ 8/10 passed
Finished │ 2026-06-28T02:31:01.000Z

Table row counts
✓ `users`           — 312 row(s) (min 1)
✗ `markets`         — 0 row(s)   (min 1)  ← FAILED
...

Error
smoke tests failed for: markets(0<1)
```

Slack errors (network issues, invalid URL) are logged but **do not affect** the
`result.success` value — a Slack outage will not mask a real backup failure.

---

## Return value

`BackupVerifier.run()` always resolves (never rejects) and returns a
`BackupVerificationResult`:

```typescript
interface BackupVerificationResult {
  runId: string;         // UUID v4 for log correlation
  success: boolean;      // true iff all steps passed
  startedAt: string;     // ISO-8601 timestamp
  finishedAt: string;    // ISO-8601 timestamp
  durationMs: number;    // wall-clock duration
  smokeTests: Array<{
    table: string;
    rowCount: number;
    passed: boolean;
    minRows: number;
  }>;
  error?: string;        // human-readable message when success is false
}
```

---

## Testing

```bash
# Run only the backup verifier test suite
npm test -- tests/backupVerifier.test.ts

# With coverage report
npm run test:coverage -- tests/backupVerifier.test.ts
```

Tests run with no live database or network connections. All external
dependencies (pg_restore, Postgres row-count queries, Slack HTTP) are injected
via constructor DI and replaced with `jest.fn()` mocks.

Test layers:

| Layer | Description |
| --- | --- |
| Happy path | Verifies runId, timestamps, restore call args, smoke-test table coverage, Slack call |
| Restore failure | pg_restore throws → `success:false`, error propagated, smoke tests skipped |
| Smoke test failure | Table row count = 0 → `success:false`, failing table named in error |
| Smoke query error | Query throws → `success:false`, error message included, short-circuits |
| Smoke timeout | Query hangs → timeout fires → `success:false` |
| Slack reporting | URL absent → skipped; Slack throws → logged but result unaffected |
| `buildSlackMessage()` | Shape, icon, runId, table listing, error block |
| `createDefaultBackupVerifier()` | Parses env vars, throws `ZodError` on missing required vars |
| `SMOKE_TEST_TABLES` | Exactly 10 entries, unique names, minRows ≥ 1 |

---

## Architecture decisions

### Why a standalone worker instead of a scheduler entry?

The verification job is an operational concern (backup integrity), not a
business-logic concern. Keeping it as a standalone process means:

- It can be triggered by external schedulers (cron, CI) independently of the
  main API server lifecycle.
- It can be killed and restarted without affecting API traffic.
- The ephemeral DB it writes to is completely isolated from the production DB.

### Why DI for restore / smoke / Slack?

Constructor injection keeps the core logic testable without standing up a
Postgres instance or hitting Slack in CI. The three production implementations
(`PgRestoreRunner`, `PgSmokeTestRunner`, `HttpSlackReporter`) are thin wrappers
over `child_process.execFile`, `pg.Pool`, and `fetch` respectively.

### Why does `run()` never throw?

Backup verification is a monitoring task. An uncaught exception could silence
the failure report to Slack. By always resolving with a `BackupVerificationResult`,
callers have full control over how to surface failures (exit code, metrics, etc.)
without needing try/catch boilerplate.

### Why 10 rows across tables?

A count ≥ 1 per table is a lightweight but meaningful integrity signal:

- It confirms pg_restore created the schema and ingested at least some data.
- It detects truncated or empty dumps that passed the restore step without error.
- It avoids slow full-table scans on large production datasets.
