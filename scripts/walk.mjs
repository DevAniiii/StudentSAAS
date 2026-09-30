// Log in once, then walk the given pages so the trace log holds one clean request
// per route. Keeping the login and the walk separate means the trace is not
// polluted by the auth flow, which is a different set of queries entirely.
//
// Pass a single path to trace exactly one page — with a shared log and no request
// id, one request per route is the only way to attribute queries to a page.
//
// Usage: node scripts/walk.mjs <baseUrl> [path ...]

const base = process.argv[2] ?? "http://127.0.0.1:3000";
const paths = process.argv.slice(3);

const login = await fetch(`${base}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({
    email: "anirban.banerjee@college.edu",
    password: "folio-demo-2026",
  }),
});
if (!login.ok) {
  console.error(`login failed: ${login.status} ${await login.text()}`);
  process.exit(1);
}
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");

for (const path of paths.length > 0 ? paths : [
  "/today",
  "/term",
  "/grades",
  "/assignments",
  "/finance",
  "/attendance",
  "/messages",
  "/settings",
]) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  const ms = performance.now() - started;
  console.log(`${String(response.status).padStart(3)}  ${ms.toFixed(0).padStart(6)} ms  ${path}`);
}
