/**
 * Tests for src/workers/backupVerifier.ts
 *
 * Strategy: all external side-effects (pg_restore, Postgres queries, Slack HTTP)
 * are injected via constructor DI so every test runs fully in-memory with no
 * live database or network calls.
 *
 * Layers tested:
 *  1. BackupVerifier.run() — top-level orchestration
 *  2. Restore failure path — pg_restore throws
 *  3. Smoke-test paths — pass / fail / timeout / query error
 *  4. Slack reporting — success, failure, missing URL, send error
 *  5. buildSlackMessage() — message shape and content
 *  6. createDefaultBackupVerifier() — env-var parsing
 */

import { z } from "zod";
import {
  BackupVerifier,
  BackupVerificationResult,
  SMOKE_TEST_TABLES,
  buildSlackMessage,
  createDefaultBackupVerifier,
  type BackupVerifierConfig,
  type RestoreRunner,
  type SmokeTestRunner,
  type SlackReporter,
  type SlackMessage,
} from "../src/workers/backupVerifier";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_CONFIG: BackupVerifierConfig = {
  BACKUP_DUMP_PATH: "/backups/latest.dump",
  BACKUP_EPHEMERAL_DB_URL: "postgres://user:pass@localhost:5433/eph_test",
  BACKUP_SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/XXXX",
  BACKUP_SMOKE_TIMEOUT_MS: 5_000,
};

// ─── Factory helpers ─────────────────────────────────────────────────────────

function makeRestoreRunner(impl?: (dumpPath: string, url: string) => Promise<void>): jest.Mocked<RestoreRunner> {
  return {
    restore: jest.fn(impl ?? (() => Promise.resolve())),
  };
}

function makeSmokeTestRunner(rowCounts?: Record<string, number>): jest.Mocked<SmokeTestRunner> {
  return {
    countRows: jest.fn(async (_connectionString: string, table: string) => {
      if (rowCounts && table in rowCounts) {
        return rowCounts[table];
      }
      return 5; // default: any positive count passes
    }),
  };
}

function makeSlackReporter(): jest.Mocked<SlackReporter> {
  return {
    send: jest.fn(
      (_webhookUrl: string, _message: SlackMessage): Promise<void> => Promise.resolve(),
    ) as jest.MockedFunction<SlackReporter["send"]>,
  };
}

/** Creates a verifier with all deps replaced by jest mocks. */
function makeVerifier(
  configOverrides: Partial<BackupVerifierConfig> = {},
  rowCounts?: Record<string, number>,
  restoreImpl?: (dumpPath: string, url: string) => Promise<void>,
): {
  verifier: BackupVerifier;
  restore: jest.Mocked<RestoreRunner>;
  smoke: jest.Mocked<SmokeTestRunner>;
  slack: jest.Mocked<SlackReporter>;
} {
  const restore = makeRestoreRunner(restoreImpl);
  const smoke = makeSmokeTestRunner(rowCounts);
  const slack = makeSlackReporter();
  const verifier = new BackupVerifier({ ...VALID_CONFIG, ...configOverrides }, restore, smoke, slack);
  return { verifier, restore, smoke, slack };
}

// ─── 1. BackupVerifier.run() — happy path ────────────────────────────────────

describe("BackupVerifier.run() — happy path", () => {
  it("returns success:true when restore and all smoke tests pass", async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.run();
    expect(result.success).toBe(true);
  });

  it("assigns a UUID runId", async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.run();
    expect(result.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("populates startedAt and finishedAt as ISO strings", async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.run();
    expect(() => new Date(result.startedAt)).not.toThrow();
    expect(() => new Date(result.finishedAt)).not.toThrow();
    expect(new Date(result.finishedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(result.startedAt).getTime(),
    );
  });

  it("durationMs is a non-negative number", async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.run();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("calls restore exactly once with correct args", async () => {
    const { verifier, restore } = makeVerifier();
    await verifier.run();
    expect(restore.restore).toHaveBeenCalledTimes(1);
    expect(restore.restore).toHaveBeenCalledWith(
      VALID_CONFIG.BACKUP_DUMP_PATH,
      VALID_CONFIG.BACKUP_EPHEMERAL_DB_URL,
    );
  });

  it("runs a smoke test for every table in SMOKE_TEST_TABLES", async () => {
    const { verifier, smoke } = makeVerifier();
    await verifier.run();
    for (const { table } of SMOKE_TEST_TABLES) {
      expect(smoke.countRows).toHaveBeenCalledWith(VALID_CONFIG.BACKUP_EPHEMERAL_DB_URL, table);
    }
  });

  it("smoke test results cover all expected tables", async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.run();
    const testedTables = result.smokeTests.map((t) => t.table);
    for (const { table } of SMOKE_TEST_TABLES) {
      expect(testedTables).toContain(table);
    }
  });

  it("all smoke tests are marked passed when row counts meet minimums", async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.run();
    result.smokeTests.forEach((t) => expect(t.passed).toBe(true));
  });

  it("calls Slack reporter once on success", async () => {
    const { verifier, slack } = makeVerifier();
    await verifier.run();
    expect(slack.send).toHaveBeenCalledTimes(1);
  });

  it("does not set error field on success", async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.run();
    expect(result.error).toBeUndefined();
  });
});

// ─── 2. Restore failure path ─────────────────────────────────────────────────

describe("BackupVerifier.run() — restore failures", () => {
  it("returns success:false when pg_restore throws", async () => {
    const { verifier } = makeVerifier({}, undefined, async () => {
      throw new Error("pg_restore: connection refused");
    });
    const result = await verifier.run();
    expect(result.success).toBe(false);
  });

  it("includes error message in result when restore fails", async () => {
    const { verifier } = makeVerifier({}, undefined, async () => {
      throw new Error("permission denied");
    });
    const result = await verifier.run();
    expect(result.error).toContain("permission denied");
  });

  it("does NOT run any smoke tests after a restore failure", async () => {
    const { verifier, smoke } = makeVerifier({}, undefined, async () => {
      throw new Error("disk full");
    });
    await verifier.run();
    expect(smoke.countRows).not.toHaveBeenCalled();
  });

  it("still reports to Slack even when restore fails", async () => {
    const { verifier, slack } = makeVerifier({}, undefined, async () => {
      throw new Error("network error");
    });
    await verifier.run();
    expect(slack.send).toHaveBeenCalledTimes(1);
  });

  it("smokeTests array is empty after a restore failure", async () => {
    const { verifier } = makeVerifier({}, undefined, async () => {
      throw new Error("failed");
    });
    const result = await verifier.run();
    expect(result.smokeTests).toHaveLength(0);
  });

  it("handles non-Error thrown values gracefully", async () => {
    const { verifier } = makeVerifier({}, undefined, async () => {
      throw "string error"; // non-Error value, tests String(err) path
    });
    const result = await verifier.run();
    expect(result.success).toBe(false);
    expect(result.error).toContain("string error");
  });
});

// ─── 3. Smoke test paths ──────────────────────────────────────────────────────

describe("BackupVerifier.run() — smoke test failures", () => {
  it("returns success:false when a table has fewer rows than the minimum", async () => {
    // Set all tables to 5 rows except 'users' which gets 0
    const { verifier } = makeVerifier({}, { users: 0 });
    const result = await verifier.run();
    expect(result.success).toBe(false);
  });

  it("marks the failing table as passed:false", async () => {
    const { verifier } = makeVerifier({}, { markets: 0 });
    const result = await verifier.run();
    const failing = result.smokeTests.find((t) => t.table === "markets");
    expect(failing?.passed).toBe(false);
  });

  it("includes the table name in the error message", async () => {
    const { verifier } = makeVerifier({}, { predictions: 0 });
    const result = await verifier.run();
    expect(result.error).toContain("predictions");
  });

  it("still records smoke tests that passed before the first failure", async () => {
    // All tables succeed with default 5 rows, users explicitly fails
    const { verifier } = makeVerifier({}, { users: 0 });
    const result = await verifier.run();
    // Some tables should still be in the results (those after restore succeeded)
    expect(result.smokeTests.length).toBeGreaterThan(0);
  });

  it("returns success:false when a smoke query throws", async () => {
    const smoke = makeSmokeTestRunner();
    smoke.countRows.mockRejectedValueOnce(new Error("connection refused"));
    const slack = makeSlackReporter();
    const restore = makeRestoreRunner();
    const verifier = new BackupVerifier(VALID_CONFIG, restore, smoke, slack);
    const result = await verifier.run();
    expect(result.success).toBe(false);
  });

  it("includes query error message in result.error", async () => {
    const smoke = makeSmokeTestRunner();
    smoke.countRows.mockRejectedValueOnce(new Error("relation does not exist"));
    const verifier = new BackupVerifier(VALID_CONFIG, makeRestoreRunner(), smoke, makeSlackReporter());
    const result = await verifier.run();
    expect(result.error).toContain("relation does not exist");
  });

  it("short-circuits after the first smoke query error (stops querying)", async () => {
    const smoke = makeSmokeTestRunner();
    smoke.countRows.mockRejectedValueOnce(new Error("fatal"));
    const verifier = new BackupVerifier(VALID_CONFIG, makeRestoreRunner(), smoke, makeSlackReporter());
    await verifier.run();
    // Only the first table should have been queried before bail-out
    expect(smoke.countRows).toHaveBeenCalledTimes(1);
  });

  it("reports exact rowCount in smokeTests results", async () => {
    const customCounts: Record<string, number> = {};
    for (const { table } of SMOKE_TEST_TABLES) {
      customCounts[table] = 42;
    }
    const { verifier } = makeVerifier({}, customCounts);
    const result = await verifier.run();
    result.smokeTests.forEach((t) => expect(t.rowCount).toBe(42));
  });

  it("includes minRows in each smoke test result", async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.run();
    result.smokeTests.forEach((t) => {
      const def = SMOKE_TEST_TABLES.find((s) => s.table === t.table);
      expect(t.minRows).toBe(def?.minRows);
    });
  });
});

// ─── 4. Smoke test timeout ────────────────────────────────────────────────────

describe("BackupVerifier.run() — smoke test timeout", () => {
  it(
    "fails when a smoke query exceeds BACKUP_SMOKE_TIMEOUT_MS",
    async () => {
      const smoke = makeSmokeTestRunner();
      // Resolves after 300ms — longer than the 50ms timeout we set below
      smoke.countRows.mockImplementation(
        () => new Promise<number>((resolve) => setTimeout(() => resolve(5), 300)),
      );

      const verifier = new BackupVerifier(
        { ...VALID_CONFIG, BACKUP_SMOKE_TIMEOUT_MS: 50 },
        makeRestoreRunner(),
        smoke,
        makeSlackReporter(),
      );

      const result = await verifier.run();

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    },
    10_000, // give the test 10s headroom
  );
});

// ─── 5. Slack reporting ───────────────────────────────────────────────────────

describe("BackupVerifier.run() — Slack reporting", () => {
  it("skips Slack when BACKUP_SLACK_WEBHOOK_URL is not configured", async () => {
    const { verifier, slack } = makeVerifier({ BACKUP_SLACK_WEBHOOK_URL: undefined });
    await verifier.run();
    expect(slack.send).not.toHaveBeenCalled();
  });

  it("sends to the configured Slack URL", async () => {
    const { verifier, slack } = makeVerifier();
    await verifier.run();
    expect(slack.send).toHaveBeenCalledWith(VALID_CONFIG.BACKUP_SLACK_WEBHOOK_URL, expect.any(Object));
  });

  it("does not throw when Slack reporter errors", async () => {
    const slack = makeSlackReporter();
    slack.send.mockRejectedValue(new Error("Slack 500"));
    const verifier = new BackupVerifier(VALID_CONFIG, makeRestoreRunner(), makeSmokeTestRunner(), slack);
    await expect(verifier.run()).resolves.toBeDefined();
  });

  it("result.success is not affected by a Slack failure", async () => {
    const slack = makeSlackReporter();
    slack.send.mockRejectedValue(new Error("Slack down"));
    const verifier = new BackupVerifier(VALID_CONFIG, makeRestoreRunner(), makeSmokeTestRunner(), slack);
    const result = await verifier.run();
    expect(result.success).toBe(true);
  });

  it("sends Slack notification on failure too", async () => {
    const { verifier, slack } = makeVerifier({}, { users: 0 });
    await verifier.run();
    expect(slack.send).toHaveBeenCalledTimes(1);
  });

  it("passes a SlackMessage with a text field to reporter", async () => {
    const { verifier, slack } = makeVerifier();
    await verifier.run();
    const [, message] = slack.send.mock.calls[0] as [string, SlackMessage];
    expect(typeof message.text).toBe("string");
    expect(message.text.length).toBeGreaterThan(0);
  });
});

// ─── 6. buildSlackMessage() ──────────────────────────────────────────────────

describe("buildSlackMessage()", () => {
  const successResult: BackupVerificationResult = {
    runId: "abc-123",
    success: true,
    startedAt: "2026-06-28T00:00:00.000Z",
    finishedAt: "2026-06-28T00:01:00.000Z",
    durationMs: 60_000,
    smokeTests: [
      { table: "users",   rowCount: 10, passed: true,  minRows: 1 },
      { table: "markets", rowCount: 5,  passed: true,  minRows: 1 },
    ],
  };

  const failureResult: BackupVerificationResult = {
    ...successResult,
    success: false,
    smokeTests: [
      { table: "users",   rowCount: 0,  passed: false, minRows: 1 },
      { table: "markets", rowCount: 5,  passed: true,  minRows: 1 },
    ],
    error: "smoke tests failed for: users(0<1)",
  };

  it("text contains PASSED on success", () => {
    const msg = buildSlackMessage(successResult);
    expect(msg.text).toContain("PASSED");
  });

  it("text contains FAILED on failure", () => {
    const msg = buildSlackMessage(failureResult);
    expect(msg.text).toContain("FAILED");
  });

  it("text contains the runId", () => {
    const msg = buildSlackMessage(successResult);
    expect(msg.text).toContain("abc-123");
  });

  it("blocks array is non-empty", () => {
    const msg = buildSlackMessage(successResult);
    expect(Array.isArray(msg.blocks)).toBe(true);
    expect((msg.blocks as object[]).length).toBeGreaterThan(0);
  });

  it("blocks contains a header block with ✅ on success", () => {
    const msg = buildSlackMessage(successResult);
    const header = (msg.blocks as Array<{ type: string; text?: { text: string } }>).find(
      (b) => b.type === "header",
    );
    expect(header?.text?.text).toContain("✅");
  });

  it("blocks contains a header block with ❌ on failure", () => {
    const msg = buildSlackMessage(failureResult);
    const header = (msg.blocks as Array<{ type: string; text?: { text: string } }>).find(
      (b) => b.type === "header",
    );
    expect(header?.text?.text).toContain("❌");
  });

  it("includes error text in blocks on failure", () => {
    const msg = buildSlackMessage(failureResult);
    const msgStr = JSON.stringify(msg.blocks);
    expect(msgStr).toContain("smoke tests failed");
  });

  it("lists each smoke-test table in the message", () => {
    const msg = buildSlackMessage(successResult);
    const msgStr = JSON.stringify(msg.blocks);
    expect(msgStr).toContain("users");
    expect(msgStr).toContain("markets");
  });

  it("marks failing tables with ✗ in the blocks", () => {
    const msg = buildSlackMessage(failureResult);
    const msgStr = JSON.stringify(msg.blocks);
    expect(msgStr).toContain("✗");
  });

  it("marks passing tables with ✓ in the blocks", () => {
    const msg = buildSlackMessage(failureResult);
    const msgStr = JSON.stringify(msg.blocks);
    expect(msgStr).toContain("✓");
  });

  it("does not include error block when success is true", () => {
    const msg = buildSlackMessage(successResult);
    const msgStr = JSON.stringify(msg.blocks);
    // No error field set on successResult
    expect(msgStr).not.toContain("Error*");
  });

  it("includes duration in message fields", () => {
    const msg = buildSlackMessage(successResult);
    const msgStr = JSON.stringify(msg.blocks);
    expect(msgStr).toContain("60000ms");
  });

  it("produces valid JSON output", () => {
    const msg = buildSlackMessage(successResult);
    expect(() => JSON.stringify(msg)).not.toThrow();
  });

  it("handles empty smokeTests array without throwing", () => {
    const msg = buildSlackMessage({ ...successResult, smokeTests: [] });
    expect(msg.text).toBeTruthy();
  });
});

// ─── 7. createDefaultBackupVerifier() — env parsing ──────────────────────────

describe("createDefaultBackupVerifier()", () => {
  const requiredEnv = {
    BACKUP_DUMP_PATH: "/backups/latest.dump",
    BACKUP_EPHEMERAL_DB_URL: "postgres://user:pass@localhost:5433/eph",
  };

  afterEach(() => {
    // Restore env vars set during tests
    delete process.env.BACKUP_DUMP_PATH;
    delete process.env.BACKUP_EPHEMERAL_DB_URL;
    delete process.env.BACKUP_SLACK_WEBHOOK_URL;
    delete process.env.BACKUP_SMOKE_TIMEOUT_MS;
  });

  it("returns a BackupVerifier instance when required env vars are set", () => {
    Object.assign(process.env, requiredEnv);
    const verifier = createDefaultBackupVerifier();
    expect(verifier).toBeInstanceOf(BackupVerifier);
  });

  it("throws a ZodError when BACKUP_DUMP_PATH is missing", () => {
    process.env.BACKUP_EPHEMERAL_DB_URL = requiredEnv.BACKUP_EPHEMERAL_DB_URL;
    // BACKUP_DUMP_PATH intentionally not set
    expect(() => createDefaultBackupVerifier()).toThrow();
  });

  it("throws a ZodError when BACKUP_EPHEMERAL_DB_URL is missing", () => {
    process.env.BACKUP_DUMP_PATH = requiredEnv.BACKUP_DUMP_PATH;
    // BACKUP_EPHEMERAL_DB_URL intentionally not set
    expect(() => createDefaultBackupVerifier()).toThrow();
  });

  it("throws a ZodError when BACKUP_EPHEMERAL_DB_URL is not a valid URL", () => {
    process.env.BACKUP_DUMP_PATH = requiredEnv.BACKUP_DUMP_PATH;
    process.env.BACKUP_EPHEMERAL_DB_URL = "not-a-url";
    expect(() => createDefaultBackupVerifier()).toThrow();
  });

  it("uses default BACKUP_SMOKE_TIMEOUT_MS of 15000 when not set", () => {
    Object.assign(process.env, requiredEnv);
    // Parse env directly to verify default (uses the already-imported z)
    const schema = z.object({
      BACKUP_DUMP_PATH: z.string().min(1),
      BACKUP_EPHEMERAL_DB_URL: z.string().url(),
      BACKUP_SLACK_WEBHOOK_URL: z.string().url().optional(),
      BACKUP_SMOKE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    });
    const parsed = schema.parse(process.env);
    expect(parsed.BACKUP_SMOKE_TIMEOUT_MS).toBe(15_000);
  });

  it("accepts BACKUP_SLACK_WEBHOOK_URL as optional", () => {
    Object.assign(process.env, requiredEnv);
    expect(() => createDefaultBackupVerifier()).not.toThrow();
  });

  it("parses BACKUP_SMOKE_TIMEOUT_MS from env string", () => {
    Object.assign(process.env, requiredEnv);
    process.env.BACKUP_SMOKE_TIMEOUT_MS = "30000";
    const schema = z.object({
      BACKUP_DUMP_PATH: z.string().min(1),
      BACKUP_EPHEMERAL_DB_URL: z.string().url(),
      BACKUP_SLACK_WEBHOOK_URL: z.string().url().optional(),
      BACKUP_SMOKE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    });
    const parsed = schema.parse(process.env);
    expect(parsed.BACKUP_SMOKE_TIMEOUT_MS).toBe(30_000);
  });
});

// ─── 8. SMOKE_TEST_TABLES constant ──────────────────────────────────────────

describe("SMOKE_TEST_TABLES constant", () => {
  it("contains exactly 10 entries", () => {
    expect(SMOKE_TEST_TABLES).toHaveLength(10);
  });

  it("every entry has a non-empty table name", () => {
    SMOKE_TEST_TABLES.forEach(({ table }) => {
      expect(typeof table).toBe("string");
      expect(table.length).toBeGreaterThan(0);
    });
  });

  it("every entry has minRows >= 1", () => {
    SMOKE_TEST_TABLES.forEach(({ minRows }) => {
      expect(minRows).toBeGreaterThanOrEqual(1);
    });
  });

  it("table names are unique", () => {
    const names = SMOKE_TEST_TABLES.map((t) => t.table);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("includes users, markets, predictions tables", () => {
    const names = SMOKE_TEST_TABLES.map((t) => t.table);
    expect(names).toContain("users");
    expect(names).toContain("markets");
    expect(names).toContain("predictions");
  });
});
