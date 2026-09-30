/**
 * Password hashing and token derivation.
 *
 * Deliberately NOT marked `server-only`: the Prisma seed has to produce hashes
 * that this module can verify, and `server-only` throws when imported outside
 * the React Server Component graph (which includes plain Node scripts). It
 * imports `node:crypto`, so it can never end up in a client bundle anyway —
 * the guard would be redundant.
 */
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

type ScryptOptions = { N: number; r: number; p: number; maxmem: number };

/** Typed wrapper so the options overload is reachable without `any`. */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * Password hashing — scrypt from `node:crypto`.
 *
 * Why scrypt over argon2/bcrypt: it ships in the Node standard library, so
 * there is no native module to compile, no prebuild to lose on a new Node
 * version, and nothing extra in the dependency tree. scrypt is memory-hard,
 * which is the property that actually matters against GPU cracking. Argon2id
 * would be the better primitive if you accept the native dependency.
 *
 * Stored format: `scrypt$N$r$p$saltB64$hashB64` — self-describing, so the cost
 * parameters can be raised later and every previously stored hash keeps
 * verifying.
 */
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

/**
 * Memory ceiling for scrypt. Node's default cap is 32 MiB; N=16384 / r=8 needs
 * roughly 16 MiB, so 64 MiB leaves headroom without letting cost parameters
 * read out of a tampered database row allocate without bound.
 */
const MAX_MEM = 64 * 1024 * 1024;

/** Normalise before hashing so composed characters behave like plain ones. */
function normalize(password: string): string {
  return password.normalize("NFKC");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(normalize(password), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAX_MEM,
  });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verify a password against a stored hash. Never throws — a malformed or
 * truncated hash is a failed login, not a 500.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Bound the parameters before allocating memory, so a poisoned row cannot
  // turn a login into an out-of-memory crash.
  if (N > 1 << 20 || r > 32 || p > 16) return false;
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = await scrypt(normalize(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEM,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Burn roughly the same CPU as a real verification.
 *
 * Called when an email does not exist, so login response time does not reveal
 * which addresses have accounts.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await scrypt("no-such-user", Buffer.alloc(16), PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAX_MEM,
  });
}

/** 256 bits of CSPRNG output, URL-safe. Session tokens and idempotency keys. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Sessions are stored as a SHA-256 digest, never in plaintext, so a database
 * leak cannot be replayed as a live login.
 *
 * SHA-256 rather than a password hash is correct here: the input is already
 * 256 bits of CSPRNG output, so there is nothing to brute-force and therefore
 * no reason to make verification slow.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison for secrets of equal expected length. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
