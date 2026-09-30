import "server-only";

/**
 * Fixed-window rate limiting, in process memory.
 *
 * SCOPE / LIMITATION, stated plainly: this is per-process. With N instances
 * behind a load balancer the effective limit is N × configured, and a rolling
 * window costs more memory than a fixed one. It is the right answer for a
 * single-node deployment and for protecting one expensive endpoint (password
 * hashing) from a runaway client; it is *not* a defence against a determined
 * distributed attacker. Swap `hit` for a Redis `INCR` + `EXPIRE` when you run
 * more than one node — the call sites do not change.
 */

interface Window {
  count: number;
  /** Epoch ms at which this window stops counting. */
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bound the map so an attacker rotating keys cannot grow it without limit. */
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number): void {
  if (windows.size < MAX_TRACKED_KEYS) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // Still oversized: drop the oldest half. Map iteration is insertion-ordered,
  // so this approximates least-recently-used closely enough for a limiter.
  if (windows.size >= MAX_TRACKED_KEYS) {
    const excess = windows.size - Math.floor(MAX_TRACKED_KEYS / 2);
    let dropped = 0;
    for (const key of windows.keys()) {
      windows.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window resets. Always present. */
  retryAfterSeconds: number;
  limit: number;
}

/**
 * Count one request against `key` and report whether it is allowed.
 * The caller is responsible for turning `allowed: false` into a 429.
 */
export function hit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: windowSeconds,
      limit,
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return {
    allowed: existing.count <= limit,
    remaining,
    retryAfterSeconds,
    limit,
  };
}

/** Read the current count without consuming budget. Used for observability. */
export function peek(key: string): number {
  const window = windows.get(key);
  if (!window || window.resetAt <= Date.now()) return 0;
  return window.count;
}

/** Clear all counters. Only for tests — never wired to a route. */
export function reset(): void {
  windows.clear();
}

/**
 * Compose a limit key. Namespace first so unrelated endpoints never collide on
 * a shared identifier such as a user id.
 */
export function rateKey(...parts: (string | number | null | undefined)[]): string {
  return parts.filter((p) => p !== null && p !== undefined).join(":");
}
