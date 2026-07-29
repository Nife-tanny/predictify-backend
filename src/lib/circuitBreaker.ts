/**
 * circuitBreaker.ts
 *
 * Generic per-name circuit breaker implementing the classic three-state machine:
 *
 *   CLOSED  → normal operation; failures are counted.
 *   OPEN    → fast-fail; all calls throw CircuitOpenError immediately.
 *   HALF_OPEN → one probe call allowed; success → CLOSED, failure → OPEN.
 *
 * Usage:
 *
 *   const breaker = getCircuitBreaker("impersonate", {
 *     failureThreshold: 5,
 *     successThreshold: 1,
 *     halfOpenAfterMs: 30_000,
 *   });
 *
 *   // Wrap any async operation:
 *   const token = await breaker.execute(() => signAccessToken(...));
 *
 * When the breaker is OPEN, `execute` throws a `CircuitOpenError` which
 * the route layer converts to HTTP 503.
 *
 * State is stored in-memory and resets on process restart, which is
 * correct for a transient fast-fail guard. Use `resetForTests()` in
 * unit tests to isolate state between test cases.
 */

import { logger } from "../config/logger";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures needed to trip the breaker from CLOSED
   * to OPEN.
   * @default 5
   */
  failureThreshold?: number;

  /**
   * Number of consecutive successes in HALF_OPEN needed to reset to CLOSED.
   * @default 1
   */
  successThreshold?: number;

  /**
   * Milliseconds to wait in OPEN state before moving to HALF_OPEN.
   * @default 30_000
   */
  halfOpenAfterMs?: number;
}

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt: number | null;
  failureThreshold: number;
  successThreshold: number;
  halfOpenAfterMs: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when `execute` is called on an open circuit breaker.
 * Route handlers should map this to HTTP 503.
 */
export class CircuitOpenError extends Error {
  readonly name = "CircuitOpenError";
  readonly circuitName: string;
  readonly openedAt: number;

  constructor(circuitName: string, openedAt: number) {
    super(`Circuit '${circuitName}' is OPEN — downstream call rejected`);
    this.circuitName = circuitName;
    this.openedAt = openedAt;
    Object.setPrototypeOf(this, CircuitOpenError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface InternalState {
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt: number | null;
  opts: Required<CircuitBreakerOptions>;
}

/** Registry of all named circuit breakers in this process. */
const registry = new Map<string, InternalState>();

function defaultOpts(
  opts: CircuitBreakerOptions = {},
): Required<CircuitBreakerOptions> {
  return {
    failureThreshold: opts.failureThreshold ?? 5,
    successThreshold: opts.successThreshold ?? 1,
    halfOpenAfterMs: opts.halfOpenAfterMs ?? 30_000,
  };
}

function createState(opts: Required<CircuitBreakerOptions>): InternalState {
  return {
    state: "CLOSED",
    failures: 0,
    successes: 0,
    openedAt: null,
    opts,
  };
}

// ---------------------------------------------------------------------------
// Circuit breaker handle
// ---------------------------------------------------------------------------

export interface CircuitBreaker {
  /** Current state of this circuit breaker. */
  readonly state: CircuitState;

  /** Snapshot of full internal state (useful for observability). */
  snapshot(): CircuitBreakerSnapshot;

  /**
   * Executes `fn` through the circuit breaker.
   *
   * - CLOSED: calls `fn`; on failure increments failure counter.
   * - OPEN: throws `CircuitOpenError` immediately (fast-fail).
   * - HALF_OPEN: lets one probe through; success resets to CLOSED,
   *   failure trips back to OPEN.
   */
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Core state-machine transitions
// ---------------------------------------------------------------------------

function resolveEffectiveState(s: InternalState, now: number): CircuitState {
  if (
    s.state === "OPEN" &&
    s.openedAt !== null &&
    now - s.openedAt >= s.opts.halfOpenAfterMs
  ) {
    s.state = "HALF_OPEN";
    s.failures = 0;
    s.successes = 0;
    logger.info({ circuit: s }, "circuit_breaker_half_open");
  }
  return s.state;
}

function onSuccess(name: string, s: InternalState): void {
  if (s.state === "HALF_OPEN") {
    s.successes += 1;
    if (s.successes >= s.opts.successThreshold) {
      s.state = "CLOSED";
      s.failures = 0;
      s.successes = 0;
      s.openedAt = null;
      logger.info({ circuitName: name, state: s.state }, "circuit_breaker_closed");
    }
  } else {
    // CLOSED — any success resets the failure counter
    s.failures = 0;
  }
}

function onFailure(name: string, s: InternalState, now: number): void {
  s.failures += 1;

  if (s.state === "HALF_OPEN" || s.failures >= s.opts.failureThreshold) {
    s.state = "OPEN";
    s.openedAt = now;
    s.successes = 0;
    logger.warn(
      { circuitName: name, failures: s.failures, openedAt: s.openedAt },
      "circuit_breaker_opened",
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns (and lazily creates) a named circuit breaker.
 *
 * If the breaker already exists, the existing instance is returned and
 * `opts` is **ignored** — options are only applied at creation time.
 * This ensures a single stable configuration across the application.
 */
export function getCircuitBreaker(
  name: string,
  opts: CircuitBreakerOptions = {},
): CircuitBreaker {
  if (!registry.has(name)) {
    registry.set(name, createState(defaultOpts(opts)));
  }

  const s = registry.get(name)!;

  return {
    get state(): CircuitState {
      return resolveEffectiveState(s, Date.now());
    },

    snapshot(): CircuitBreakerSnapshot {
      return {
        name,
        state: s.state,
        failures: s.failures,
        successes: s.successes,
        openedAt: s.openedAt,
        failureThreshold: s.opts.failureThreshold,
        successThreshold: s.opts.successThreshold,
        halfOpenAfterMs: s.opts.halfOpenAfterMs,
      };
    },

    async execute<T>(fn: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const effective = resolveEffectiveState(s, now);

      if (effective === "OPEN") {
        throw new CircuitOpenError(name, s.openedAt!);
      }

      try {
        const result = await fn();
        onSuccess(name, s);
        return result;
      } catch (err) {
        if (err instanceof CircuitOpenError) {
          // Propagate without counting — shouldn't happen, but be safe.
          throw err;
        }
        onFailure(name, s, Date.now());
        throw err;
      }
    },
  };
}

/**
 * Test-only: resets the registry so every test starts with a clean slate.
 * Never call this in production code.
 */
export function resetCircuitBreakersForTests(): void {
  registry.clear();
}

/**
 * Test-only: forcibly sets the state of a named breaker so tests can drive
 * specific scenarios without having to trigger the threshold conditions.
 *
 * If the breaker doesn't exist yet it is created. If it already exists its
 * internal state object is **mutated in-place** so that any existing handles
 * (returned from earlier `getCircuitBreaker` calls) immediately see the new
 * state through their closure reference.
 */
export function forceCircuitStateForTests(
  name: string,
  state: CircuitState,
  opts: CircuitBreakerOptions = {},
): void {
  if (!registry.has(name)) {
    // Create the entry fresh and set the desired state.
    const resolvedOpts = defaultOpts(opts);
    const s = createState(resolvedOpts);
    applyForcedState(s, state);
    registry.set(name, s);
  } else {
    // Mutate in-place so handles that already hold a reference to `s` see
    // the new state without needing to re-call getCircuitBreaker.
    const s = registry.get(name)!;
    applyForcedState(s, state);
  }
}

function applyForcedState(s: InternalState, state: CircuitState): void {
  s.state = state;
  s.failures = state === "OPEN" ? s.opts.failureThreshold : 0;
  s.successes = 0;
  s.openedAt = state === "OPEN" ? Date.now() : null;
}
