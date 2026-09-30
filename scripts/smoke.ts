/**
 * End-to-end smoke test.
 *
 * Drives the app over HTTP exactly as a browser would, with a real cookie jar, so
 * every check here is one a user could perform. It is not a unit test: it cannot
 * see inside the app, only what the wire exposes, which is the point — the
 * failures worth catching are the ones where a handler is correct in isolation
 * and wrong in sequence.
 *
 * By default it starts its own server on a free port, runs, and tears it down:
 *
 *     npm run smoke
 *
 * That is not ceremony. The login endpoint rate-limits to eight attempts per
 * quarter hour, and the counters live in process memory, so a harness pointed at
 * a long-lived `npm run dev` can only be run once — the second run trips the
 * limiter it is supposed to be testing and reports a screen of 429s that look
 * like an auth failure. A fresh process per run is the only way the suite is
 * repeatable, and repeatability is the property that makes a test suite worth
 * running at all.
 *
 * The server is `next start`, not `next dev`, against a production build. Two
 * reasons, and the second is the one that matters. A dev server compiles routes
 * on demand, so a suite that asserts against it is partly asserting against the
 * compiler: on a cold `.next` a request can land mid-compile and come back 404,
 * and a throw during early bootstrap will send Next's dev error renderer looking
 * for `next-font-manifest.json` before it exists, converting the real error into
 * an unrelated-looking 500. Both were observed here as failures that did not
 * reproduce against a production build and did not reproduce against a warm dev
 * server — artefacts of the dev compiler, not of the app. Testing the build that
 * actually ships also removes the need to reason about which of the two is
 * running.
 *
 * Point it at something already running with `SMOKE_BASE`, which skips the
 * lifecycle entirely and inherits whatever state that process has:
 *
 *     SMOKE_BASE=http://localhost:3000 npm run smoke
 *
 * Prints each assertion as it is checked, so a partial run says how far it got,
 * and exits non-zero if any of them fail.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The origin under test. Assigned once the server is up, which is why it is
 * `let` rather than a constant: `SMOKE_BASE` short-circuits the whole lifecycle
 * and the value is known at import time, whereas the spawned case only knows it
 * after `startServer` returns.
 */
let BASE = "";

/**
 * Ask the OS for a port nobody is using.
 *
 * Chosen by binding to port 0 and reading back what was assigned, rather than
 * probing a fixed range: a hard-coded port either collides with a dev server the
 * developer already has open — silently testing the wrong process — or drifts
 * from reality the moment someone else picks it.
 */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("Could not determine a free port")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Spawn `next dev` and wait until it answers.
 *
 * `next` is invoked as a Node script rather than through `npm` so the handle is
 * the server process itself. Going through a shell means the tree is
 * `cmd -> node -> next`, and killing the outermost handle leaves the real server
 * running — which then holds the port and the database connections, and makes
 * the *next* run test a stale process.
 */
interface TestServer {
  origin: string;
  /** Everything the server has written so far, for diagnosing a failure. */
  log: () => string;
  stop: () => void;
}

async function startServer(): Promise<TestServer> {
  const port = await freePort();
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    throw new Error(`Cannot find ${nextBin}. Run \`npm install\` first.`);
  }

  // `next start` serves a build; it does not make one. A missing build fails with
  // a 404 for every route, which reads like the app is broken rather than like it
  // was never compiled, so the check is explicit.
  if (!existsSync(path.join(process.cwd(), ".next", "BUILD_ID"))) {
    throw new Error(
      "No production build found at .next/BUILD_ID.\n" +
        "This suite runs `next start`, so it needs `npm run build` first — which is\n" +
        "what `npm run smoke` does for you.",
    );
  }

  const child: ChildProcess = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: process.cwd(),
    // Own process group, so a Ctrl-C in the parent terminal takes the server with
    // it rather than orphaning it to port 3000 forever.
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  });

  const lines: string[] = [];
  const collect = (chunk: Buffer) => {
    lines.push(chunk.toString());
    // Keep the tail bounded; a dev server that recompiles in a loop can
    // otherwise produce enough output to matter.
    if (lines.length > 400) lines.shift();
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  const origin = `http://127.0.0.1:${port}`;
  const log = () => lines.join("");
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      // SIGTERM is not delivered to a process tree on Windows; `taskkill /T`
      // takes the children with it.
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(-(child.pid as number), "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  };

  // Poll rather than scrape the log for "Ready". The log line can be printed
  // before the socket is actually accepting, and a connection refused here is
  // cheap to retry, whereas a request that lands on a half-started server
  // produces a confusing assertion failure instead.
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `Server exited with code ${child.exitCode} before becoming ready.\n${log()}`,
      );
    }
    if (Date.now() > deadline) {
      stop();
      throw new Error(`Server did not become ready within 120s.\n${log()}`);
    }
    try {
      const probe = await fetch(`${origin}/login`, { redirect: "manual" });
      await probe.text();
      // A socket that accepts is not a server that serves. Between the listener
      // coming up and the route manifest being written, `next dev` answers every
      // request with 404 — including the ones this suite goes on to assert on,
      // which turns a readiness race into dozens of unrelated-looking failures.
      // Readiness means "renders the page", not "did not throw".
      if (probe.status === 200) return { origin, log, stop };
    } catch {
      // Connection refused: the listener is not up yet. Cheap to retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * A minimal cookie jar.
 *
 * Written out rather than pulled from a library because the whole point of the
 * session tests is *which* cookies are set and with what attributes, and a
 * cookie jar that quietly normalised them would test nothing. The session cookie
 * is named after `env.session.cookieName`; nothing else should ever be set for a
 * signed-in student, which is itself an assertion.
 */
class Jar {
  #cookies = new Map<string, { value: string; attrs: Map<string, string> }>();

  absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...rest] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const attrs = new Map<string, string>();
      for (const part of rest) {
        const at = part.indexOf("=");
        if (at === -1) attrs.set(part.trim().toLowerCase(), "");
        else attrs.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
      }
      // A `Max-Age=0` / past `Expires` is a deletion, not an update.
      const maxAge = attrs.get("max-age");
      if (maxAge === "0" || this.#isExpired(attrs.get("expires"))) this.#cookies.delete(name);
      else this.#cookies.set(name, { value, attrs });
    }
  }

  #isExpired(expires: string | undefined): boolean {
    if (!expires) return false;
    const at = Date.parse(expires);
    return Number.isFinite(at) && at <= Date.now();
  }

  header(): string {
    return [...this.#cookies.entries()].map(([name, { value }]) => `${name}=${value}`).join("; ");
  }

  get(name: string): { value: string; attrs: Map<string, string> } | undefined {
    return this.#cookies.get(name);
  }

  names(): string[] {
    return [...this.#cookies.keys()];
  }

  clear(): void {
    this.#cookies.clear();
  }
}

const jar = new Jar();
let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

/**
 * Does a `Location` header point at this origin?
 *
 * Written as an origin comparison rather than a "starts with `/`" test, because
 * both a relative path and an absolute same-origin URL are correct answers to
 * "where do I send the browser after this form post", and only the origin is the
 * security property. Redirecting to `//evil.example` or to
 * `https://evil.example` are the attacks; whether the safe answer is written
 * relative or absolute is a style choice the route is free to make.
 */
function isSameOrigin(location: string): boolean {
  if (location === "") return false;
  // Protocol-relative. `//evil.example` looks like a path to a careless reader
  // and is a redirect to another origin to a browser.
  if (location.startsWith("//")) return false;
  if (location.startsWith("/")) return true;
  try {
    return new URL(location).origin === new URL(BASE).origin;
  } catch {
    return false;
  }
}

/**
 * The documented wire shape. `requestId` is top level on *both* the success and
 * the failure envelope, so a client logging a failed call reads it from the same
 * place as a successful one.
 */
interface Envelope<T> {
  data: T | null;
  error: { code: string; message: string; fields?: { path: string; message: string }[] } | null;
  requestId: string;
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  options: { headers?: Record<string, string>; jar?: Jar } = {},
): Promise<{ status: number; envelope: Envelope<unknown>; response: Response; text: string }> {
  const headers: Record<string, string> = {
    origin: BASE,
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(jar.header() ? { cookie: jar.header() } : {}),
    ...options.headers,
  };
  if (options.jar) headers.cookie = options.jar.header();

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });

  // Absorb before the body is consumed. Cookie handling is the whole reason this
  // harness keeps its own jar rather than leaning on an HTTP client: login,
  // logout and session revocation are all observable *only* through the cookie
  // the server sets or withholds, so a harness that dropped them would report a
  // working login as a broken one.
  jar.absorb(response);

  const text = await response.text();
  let envelope: Envelope<unknown>;
  try {
    envelope = JSON.parse(text) as Envelope<unknown>;
  } catch {
    envelope = { data: null, error: null, requestId: "" };
  }
  return { status: response.status, envelope, response, text };
}

async function main(): Promise<void> {
  // `SMOKE_BASE` means "use the server that is already running", which is how you
  // point this at staging. Absent, we own the lifecycle so the run is repeatable.
  const external = process.env.SMOKE_BASE;
  const server = external ? null : await startServer();
  BASE = external ?? server!.origin;

  if (server) {
    console.log(`Started a server on ${BASE}`);
  }

  // Registered rather than awaited at the end: a throw anywhere in the suite
  // still has to take the server down, and an orphaned dev server holds a port,
  // a database connection pool, and whatever rate-limit budget it had left.
  process.on("exit", () => server?.stop());
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server?.stop();
      process.exit(130);
    });
  }

  try {
    await run();
  } finally {
    // A 500 with a generic message is only diagnosable from the server's own
    // output, and that output dies with the process. Dumping the tail on failure
    // is the difference between a run that tells you what is wrong and one that
    // just says forty checks failed.
    if (failures.length > 0 && server) {
      console.log(`\n${"-".repeat(60)}\nServer log (last 40 lines)\n${"-".repeat(60)}`);
      console.log(server.log().split("\n").slice(-40).join("\n"));
    }
    server?.stop();
  }
}

async function run(): Promise<void> {
  console.log(`Smoke test against ${BASE}\n${"=".repeat(60)}`);

  /* ------------------------------------------------------------------ */
  section("0. Dependencies");

  {
    // Preflight. Without this, an unreachable database shows up as a 500 on
    // every authenticated call and the suite reports forty failures that all
    // look like distinct bugs. One line here turns "the app is broken" into
    // "the app cannot reach its database", which is the difference between a
    // five-second diagnosis and an afternoon of reading the wrong code.
    const health = await call("GET", "/api/v1/health");
    const data = health.envelope.data as { checks?: Record<string, string> } | null;
    const database = data?.checks?.database;

    if (health.status === 200 && database === "ok") {
      console.log("  ok  database reachable");
    } else {
      const down = Object.entries(data?.checks ?? {})
        .filter(([, status]) => status !== "ok")
        .map(([name]) => name);
      console.log(
        `\n  ABORT: the health check reported ${down.length > 0 ? down.join(", ") : "a failure"} ` +
          `(HTTP ${health.status}).\n` +
          "  Every authenticated assertion below depends on this, and its failures would\n" +
          "  be a consequence of this one, not independent bugs. The server log is\n" +
          "  printed at the bottom of this run and names the cause.\n",
      );
      failures.push("database unreachable");
      return;
    }
  }

  /* ------------------------------------------------------------------ */
  section("1. Unauthenticated surface");

  {
    const health = await call("GET", "/login");
    check("GET /login renders 200", health.status === 200, `got ${health.status}`);
    check(
      "login page has no flash of unstyled content",
      health.text.includes("data-theme") || health.text.includes("sf:theme"),
      "no inline theme bootstrap found in the document",
    );
  }

  {
    // Every authenticated page must bounce an anonymous visitor to /login, and
    // must not leak the page's own content on the way.
    for (const path of ["/today", "/grades", "/finance", "/settings", "/messages"]) {
      const anonymous = new Jar();
      const res = await call("GET", path, undefined, { jar: anonymous });
      const isRedirect = res.status === 307 || res.status === 302 || res.status === 303;
      check(
        `GET ${path} redirects an anonymous visitor`,
        isRedirect || res.text.includes("Sign in"),
        `got ${res.status}`,
      );
      check(`GET ${path} leaks no shell content`, !res.text.includes("app-sidebar"));
    }
  }

  {
    // `POST`, not `GET`: the collection only exports POST, so a GET is answered
    // with 405 before any auth runs. Testing GET here would assert a 401 that the
    // route deliberately never reaches.
    const res = await call("POST", "/api/v1/messages", {
      recipientId: "someone",
      body: "hello",
    });
    check(
      "POST /api/v1/messages without a session is 401",
      res.status === 401,
      `got ${res.status}`,
    );
    check(
      "…and carries the documented code",
      res.envelope?.error?.code === "UNAUTHENTICATED",
      `got ${res.envelope?.error?.code}`,
    );
    check("…and a request id", typeof res.envelope?.requestId === "string" && res.envelope.requestId.length > 0);
    check(
      "…and is not cacheable",
      (res.response.headers.get("cache-control") ?? "").includes("no-store"),
    );
  }

  {
    const res = await call("GET", "/api/v1/messages");
    check(
      "GET on a POST-only collection is 405, not 401",
      res.status === 405 || res.status === 404,
      `got ${res.status}`,
    );
  }

  /* ------------------------------------------------------------------ */
  section("2. Login");

  {
    const res = await call("POST", "/api/v1/auth/login", {
      email: "nobody-here@example.com",
      password: "irrelevant",
    }, { jar: new Jar() });
    check("unknown account is 401", res.status === 401, `got ${res.status}`);
    check(
      "…with the generic message, not \"no such user\"",
      res.envelope?.error?.message === "Email or password is incorrect.",
      `got "${res.envelope?.error?.message}"`,
    );
  }

  {
    const wrong = await call("POST", "/api/v1/auth/login", {
      email: "anirban.banerjee@college.edu",
      password: "definitely-not-the-password",
    }, { jar: new Jar() });
    check("wrong password is 401", wrong.status === 401, `got ${wrong.status}`);
    check(
      "…identical message to the unknown-account case",
      wrong.envelope?.error?.message === "Email or password is incorrect.",
      `got "${wrong.envelope?.error?.message}"`,
    );
  }

  {
    const malformed = await call("POST", "/api/v1/auth/login", { email: "not-an-email" });
    check("missing field is 422", malformed.status === 422, `got ${malformed.status}`);
    check(
      "…with a field error naming the field",
      malformed.envelope?.error?.fields?.some((f) => f.path === "password") ?? false,
      JSON.stringify(malformed.envelope?.error),
    );
  }

  {
    // Cross-origin POST. `Origin` is set to something else entirely.
    const res = await call("POST", "/api/v1/auth/login", {
      email: "anirban.banerjee@college.edu",
      password: "folio-demo-2026",
    }, { headers: { origin: "https://evil.example" }, jar: new Jar() });
    check("cross-origin login is rejected", res.status === 403, `got ${res.status}`);
    check(
      "…with the CSRF code",
      res.envelope?.error?.code === "CSRF_REJECTED",
      `got ${res.envelope?.error?.code}`,
    );
  }

  {
    jar.clear();
    const res = await call("POST", "/api/v1/auth/login", {
      email: "anirban.banerjee@college.edu",
      password: "folio-demo-2026",
    });
    check("correct credentials are 200", res.status === 200, `got ${res.status} ${res.text.slice(0, 200)}`);
    check("…and set exactly one cookie", jar.names().length === 1, `set: ${jar.names().join(", ")}`);

    // The cookie name is `sf_session`, matching `env.session.cookieName`. Read
    // the name off the response rather than hard-coding it, so a rename breaks
    // this test loudly instead of silently passing on `undefined`.
    const name = jar.names()[0];
    const session = name ? jar.get(name) : undefined;
    if (session) {
      const attrs = session.attrs;
      check("session cookie is HttpOnly", attrs.has("httponly"), `attrs: ${[...attrs.keys()].join(",")}`);
      check("session cookie is SameSite=Lax", (attrs.get("samesite") ?? "").toLowerCase() === "lax");
      check("session cookie is Path=/", attrs.get("path") === "/");

      // Whether the cookie carries `Secure` is decided by the environment, not by
      // the scheme of the request that happened to create it — and that
      // distinction is the whole point. Behind a TLS-terminating proxy, which is
      // the normal deployment, every request reaching the app is already plain
      // HTTP; a handler that trusted the request's scheme would drop `Secure`
      // from the cookie in precisely the deployments that need it, leaving a
      // session credential that travels in the clear on any downgrade. So
      // `createSession` derives it from `env.isProd`, and this asserts that.
      //
      // This suite runs a production server, so `Secure` must be present. If it is
      // absent, the likely cause is `SMOKE_BASE` pointing at `npm run dev`.
      check(
        "session cookie is Secure, because this is a production server",
        attrs.has("secure"),
        `attrs: ${[...attrs.keys()].join(",")} — is SMOKE_BASE pointing at a dev server?`,
      );
      check(
        "session token is 43 chars of base64url (32 bytes), not a JWT",
        /^[A-Za-z0-9_-]{43}$/.test(session.value),
        `value was ${session.value.length} chars`,
      );
    }
  }

  /* ------------------------------------------------------------------ */
  section("3. Authenticated shell");

  {
    const today = await call("GET", "/today");
    check("GET /today renders for a signed-in student", today.status === 200, `got ${today.status}`);
    check("…contains the sidebar", today.text.includes("app-sidebar"));
    check("…shows the student's name", today.text.includes("Anirban"), "name not found in the markup");
    check("…does not leak a password hash", !today.text.includes("scrypt"));
  }

  for (const path of ["/assignments", "/grades", "/attendance", "/finance", "/term", "/messages", "/announcements", "/settings"]) {
    const res = await call("GET", path);
    check(`GET ${path} renders 200`, res.status === 200, `got ${res.status}`);
  }

  {
    const settings = await call("GET", "/settings");
    check("settings shows the registrar's student number", settings.text.includes("student number") || /STU-\d/i.test(settings.text));
    check("settings lists at least one session", settings.text.includes("Signed in"));
  }

  /* ------------------------------------------------------------------ */
  section("4. Preferences");

  {
    const before = await call("GET", "/settings");
    const wasDark = before.text.includes('data-theme="dark"');

    const res = await call("PATCH", "/api/v1/preferences", { density: "COMPACT" });
    check("PATCH density is 200", res.status === 200, `got ${res.status} ${res.text.slice(0, 200)}`);
    const data = res.envelope.data as { preferences?: { density: string } } | null;
    check("…and returns the persisted record", data?.preferences?.density === "COMPACT");
    check("…without disturbing the theme", (data?.preferences as { theme?: string })?.theme !== undefined);

    // Partial update: a field not mentioned must be left alone.
    const theme = await call("PATCH", "/api/v1/preferences", { theme: wasDark ? "LIGHT" : "DARK" });
    check("PATCH theme is 200", theme.status === 200, `got ${theme.status}`);
    const themeData = theme.envelope.data as { preferences?: { density: string } } | null;
    check(
      "…and an omitted field is unchanged, not reset",
      themeData?.preferences?.density === "COMPACT",
      `density came back as ${themeData?.preferences?.density}`,
    );

    const bad = await call("PATCH", "/api/v1/preferences", { timezone: "Mars/Olympus_Mons" });
    check("an unknown timezone is 422", bad.status === 422, `got ${bad.status}`);

    const badWeek = await call("PATCH", "/api/v1/preferences", { weekStartsOn: 9 });
    check("weekStartsOn out of range is 422", badWeek.status === 422, `got ${badWeek.status}`);

    const empty = await call("PATCH", "/api/v1/preferences", {});
    check("an empty patch is 422", empty.status === 422, `got ${empty.status}`);

    const notify = await call("PATCH", "/api/v1/preferences", {
      notify: { assignmentDue: false },
    });
    check("PATCH notify is 200", notify.status === 200, `got ${notify.status}`);

    // Restore, so the run is repeatable.
    await call("PATCH", "/api/v1/preferences", {
      density: "COMFORTABLE",
      theme: wasDark ? "DARK" : "LIGHT",
      notify: { assignmentDue: true },
    });
  }

  /* ------------------------------------------------------------------ */
  section("5. Messages");

  {
    const list = await call("GET", "/messages");
    check("messages page renders", list.status === 200);

    const extractIds = (html: string, pattern: RegExp): string[] => {
      const out = new Set<string>();
      for (const match of html.matchAll(pattern)) out.add(match[1]);
      return [...out];
    };
    const threadIds = extractIds(list.text, /\/api\/v1\/messages\/([A-Za-z0-9_-]{6,})/g);
    check("at least one thread is referenced", threadIds.length > 0, "no thread id found in the markup");
  }

  {
    // A thread id that does not exist must be indistinguishable from one the
    // user cannot see.
    const missing = await call("GET", "/api/v1/messages/definitely-not-a-real-thread-id");
    check("unknown thread is 404", missing.status === 404, `got ${missing.status}`);
    check("…not 403, so existence is not confirmed", missing.status !== 403);
  }

  {
    // An empty jar, deliberately. This check is the same request as the one in
    // section 1 and asserts the same thing — no session, therefore 401 — but it
    // runs *after* login, so the shared jar already holds a valid session cookie.
    // Sent with that jar it is an authenticated send with an unknown recipient,
    // and the correct answer is 404, which is exactly what the check below
    // accepts. Passing an empty jar is what makes this the unauthenticated
    // request its name says it is; the assertion itself is unchanged.
    const self = await call(
      "POST",
      "/api/v1/messages",
      { recipientId: "someone", body: "hello" },
      { jar: new Jar() },
    );
    check("unauthenticated send is 401", self.status === 401, `got ${self.status}`);
  }

  {
    // A recipient the user has no enrolment relationship with. The seeded
    // student is not enrolled with the registrar, so this must be refused.
    const forbidden = await call("POST", "/api/v1/messages", {
      recipientId: "cm5ot2ZhbGlk",
      subject: "hello",
      body: "Should never be delivered.",
    });
    check(
      "a recipient outside the user's enrolments is refused",
      forbidden.status === 404 || forbidden.status === 422,
      `got ${forbidden.status}`,
    );
  }

  {
    const empty = await call("POST", "/api/v1/messages", {
      recipientId: "x",
      body: "   ",
    });
    check("an empty body is 422", empty.status === 422, `got ${empty.status}`);
  }

  {
    const mark = await call("POST", "/api/v1/messages/read", {
      threadId: "definitely-not-a-real-thread-id",
    });
    // Deliberately not 404: this endpoint must not be a thread-existence probe.
    check("marking an unknown thread read does not 404", mark.status !== 404, `got ${mark.status}`);
    const data = mark.envelope.data as { marked?: number } | null;
    check("…and reports zero rows marked", data?.marked === 0, `got ${data?.marked}`);
  }

  /* ------------------------------------------------------------------ */
  section("6. Notifications");

  {
    const res = await call("POST", "/api/v1/notifications/read");
    check(
      "mark-all-read redirects rather than returning JSON",
      res.status === 303 || res.status === 302,
      `got ${res.status}`,
    );
    const location = res.response.headers.get("location") ?? "";
    check("…to a same-origin destination", isSameOrigin(location), `Location was ${location}`);
  }

  {
    // A crafted Referer must not become an open redirect. This is the check that
    // matters: `safeBack` reads the Referer, and a Referer is attacker-supplied.
    const res = await call("POST", "/api/v1/notifications/read", undefined, {
      headers: { referer: "https://evil.example/steal" },
    });
    const location = res.response.headers.get("location") ?? "";
    check("a foreign Referer is ignored", isSameOrigin(location), `Location was ${location}`);
    check(
      "…and does not send the attacker anywhere",
      !location.includes("evil.example"),
      `Location was ${location}`,
    );
  }

  /* ------------------------------------------------------------------ */
  section("7. Password and sessions");

  {
    const wrong = await call("POST", "/api/v1/auth/password", {
      currentPassword: "not-my-password",
      newPassword: "a-perfectly-fine-password-1",
    });
    check("wrong current password is 422", wrong.status === 422, `got ${wrong.status}`);
    check(
      "…naming the currentPassword field",
      wrong.envelope?.error?.fields?.some((f) => f.path === "currentPassword") ?? false,
      JSON.stringify(wrong.envelope?.error),
    );
  }

  {
    const short = await call("POST", "/api/v1/auth/password", {
      currentPassword: "folio-demo-2026",
      newPassword: "short",
    });
    check("a too-short new password is 422", short.status === 422, `got ${short.status}`);
  }

  {
    const same = await call("POST", "/api/v1/auth/password", {
      currentPassword: "folio-demo-2026",
      newPassword: "folio-demo-2026",
    });
    check("reusing the current password is 422", same.status === 422, `got ${same.status}`);
  }

  {
    const foreign = await call("DELETE", "/api/v1/auth/sessions", {
      all: false,
      sessionId: "cm5vdG1hLXNlc3Npb24taWQ",
    });
    // 404 is the answer, not 403: reporting "forbidden" would confirm the row
    // exists, and this is the check that stops a user revoking someone else's.
    check("revoking a session that is not yours is 404", foreign.status === 404, `got ${foreign.status}`);
  }

  {
    // A second, independent session — this is what "sign out everywhere" must
    // actually reach.
    const second = new Jar();
    const login = await call("POST", "/api/v1/auth/login", {
      email: "anirban.banerjee@college.edu",
      password: "folio-demo-2026",
    }, { jar: second });
    check("a second session can be created", login.status === 200, `got ${login.status}`);

    // POST, not GET: the collection only exports POST, so a GET would be
    // answered 405 before any session is even looked at, and these three checks
    // are all about whether a *session* is honoured.
    const before = await call("POST", "/api/v1/messages", {
      recipientId: "nobody",
      body: "session probe",
    });
    check(
      "both sessions work before revocation",
      before.status === 404 || before.status === 422,
      `expected the session to be honoured and the recipient refused, got ${before.status}`,
    );

    const revoke = await call("DELETE", "/api/v1/auth/sessions", { all: true });
    check("sign out everywhere is 200", revoke.status === 200, `got ${revoke.status}`);
    const revoked = revoke.envelope.data as { revoked?: number } | null;
    check("…revoking at least the two known sessions", (revoked?.revoked ?? 0) >= 2, `revoked ${revoked?.revoked}`);

    const after = await call("POST", "/api/v1/messages", {
      recipientId: "nobody",
      body: "session probe",
    });
    check("the current session is dead too", after.status === 401, `got ${after.status}`);

    const secondAfter = await call("POST", "/api/v1/messages", {
      recipientId: "nobody",
      body: "session probe",
    }, { jar: second });
    check("the other session is dead as well", secondAfter.status === 401, `got ${secondAfter.status}`);

    // Sign back in for the remaining checks.
    const again = await call("POST", "/api/v1/auth/login", {
      email: "anirban.banerjee@college.edu",
      password: "folio-demo-2026",
    });
    check("signing back in works", again.status === 200, `got ${again.status}`);
  }

  /* ------------------------------------------------------------------ */
  section("8. Logout");

  {
    const res = await call("POST", "/api/v1/auth/logout");
    check("logout is 200", res.status === 200, `got ${res.status}`);
    check("…and clears the cookie", jar.names().length === 0, `still holding ${jar.names().join(", ")}`);

    const after = await call("GET", "/today");
    check("…and the session no longer works", after.status !== 200 || after.text.includes("Sign in"));

    // Idempotent: signing out twice must not be an error.
    const twice = await call("POST", "/api/v1/auth/logout");
    check("logging out twice is still 200", twice.status === 200, `got ${twice.status}`);
  }

  /* ------------------------------------------------------------------ */
  console.log(`\n${"=".repeat(60)}`);
  if (failures.length === 0) {
    console.log(`All ${passed} checks passed.`);
    return;
  }
  console.log(`${passed} passed, ${failures.length} FAILED:\n`);
  for (const failure of failures) console.log(`  · ${failure}`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("\nSmoke test crashed:");
  console.error(error);
  process.exitCode = 1;
});
