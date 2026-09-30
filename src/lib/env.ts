/**
 * Environment configuration.
 *
 * Read once, validated once, at module load. A missing or malformed variable
 * must fail the process at boot, not surface as a confusing 500 three hours
 * into a deploy.
 *
 * Only variables prefixed `NEXT_PUBLIC_` are exposed to the browser. None of
 * the secrets here carry that prefix.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function parseNodeEnv(value: string): "development" | "production" | "test" {
  if (value === "production" || value === "test" || value === "development") return value;
  throw new Error(`NODE_ENV must be development|production|test, received "${value}"`);
}

const nodeEnv = parseNodeEnv(optional("NODE_ENV", "development"));
const sessionSecret = required("SESSION_SECRET");

// A short secret means forgeable session cookies. Refuse it in production.
if (nodeEnv === "production" && sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters in production");
}

if (nodeEnv !== "production" && sessionSecret.includes("insecure")) {
  // Loud, but not fatal — local development must keep working.
  console.warn(
    "[env] SESSION_SECRET looks like a placeholder. Fine for local dev, " +
      "never acceptable in production.",
  );
}

export const env = {
  nodeEnv,
  isDev: nodeEnv === "development",
  isProd: nodeEnv === "production",
  isTest: nodeEnv === "test",

  databaseUrl: required("DATABASE_URL"),

  appUrl: optional("APP_URL", "http://localhost:3000").replace(/\/+$/, ""),
  timezone: optional("APP_TIMEZONE", "UTC"),

  /** Session lifetime. Sliding: extended on activity, capped at maxAge. */
  session: {
    cookieName: "sf_session",
    maxAgeSeconds: 60 * 60 * 24 * 14, // 14 days
    idleTimeoutSeconds: 60 * 60 * 24 * 3, // 3 days of inactivity
    secret: sessionSecret,
  },

  /** Login throttling. Per-process; see `lib/security/rate-limit.ts` for the
   *  multi-instance caveat. */
  rateLimit: {
    loginMaxAttempts: 8,
    loginWindowSeconds: 15 * 60,
    writeMaxAttempts: 120,
    writeWindowSeconds: 60,
    /**
     * Messages a student may start per hour.
     *
     * Generous for real use — nobody sends twenty messages to their instructors
     * in an hour — but low enough that a stolen session cannot be used to flood
     * an instructor's inbox from a loop. A breach is visible as a burst from one
     * account, and this bounds it.
     */
    messageMaxPerHour: 20,
  },

  /** Sent on every outbound log line so a single request can be reconstructed. */
  observability: {
    serviceName: "scholarfolio",
    /**
     * Reported by the health endpoint so a monitor can distinguish a fresh
     * deployment from a stale one still serving the old build. Defaults to the
     * VCS revision, and is overridable for images built outside a checkout.
     */
    version: optional("APP_VERSION", "dev"),
  },
} as const;

export type Env = typeof env;
