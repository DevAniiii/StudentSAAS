import "server-only";

import { headers } from "next/headers";
import { env } from "../env";

/**
 * CSRF defence for state-changing requests.
 *
 * Two independent layers, because either alone has a known failure mode:
 *
 *  1. The session cookie is `SameSite=Lax`, which already withholds it from
 *     cross-site POSTs in every browser that matters.
 *  2. This origin check, because `SameSite` is a browser policy we do not
 *     control and can be bypassed by same-site subdomain attackers
 *     (`evil.app.example.com` is same-site as `app.example.com`).
 *
 * A token round-trip would be stronger still, but it costs a render-blocking
 * fetch on every write. Lax + origin is the standard pairing and covers the
 * realistic cases.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Throw if `request` is an unsafe cross-origin request.
 *
 * Returns silently for safe methods and for same-origin requests.
 */
export async function assertSameOrigin(request: Request): Promise<void> {
  if (SAFE_METHODS.has(request.method)) return;

  const origin = request.headers.get("origin");

  if (!origin) {
    // Browsers always attach Origin to unsafe cross-origin requests. A missing
    // one is a non-browser client (curl, server-to-server, a test), which is
    // not subject to CSRF. Refusing here would break legitimate integrations.
    return;
  }

  // `Sec-Fetch-Site` is set by every current browser and is unforgeable from
  // JavaScript. When present it is the strongest signal available.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "none") return;

  const allowed = new Set<string>([env.appUrl]);
  // Also accept the Host-derived origin so the app works behind a custom
  // hostname or a preview deployment whose public URL differs from APP_URL.
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? (env.isProd ? "https" : "http");
    allowed.add(`${proto}://${host}`);
  }

  if (!allowed.has(origin)) {
    // Thrown as a plain Error on purpose: `toErrorResponse` maps anything
    // unrecognised to a generic 500. Use AppError here for a 403 the client
    // can actually distinguish.
    const { AppError, ErrorCode } = await import("../http/errors");
    throw new AppError(
      ErrorCode.CSRF_REJECTED,
      403,
      "This request came from an unexpected origin and was rejected.",
    );
  }
}

/** Current request's best-effort client identity, for rate-limit keys. */
export async function clientFingerprint(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip = forwarded ? (forwarded.split(",")[0] ?? "").trim() : "";
  return ip || headerList.get("x-real-ip") || "unknown";
}
