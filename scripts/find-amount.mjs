// Print every dollar-shaped amount in a page, with enough context to identify
// where it came from. Used to chase a single bad figure rather than to assert
// anything — `check-render.mjs` reports that one exists, this says what it is.
//
// Usage: node scripts/find-amount.mjs <path> [baseUrl]

const path = process.argv[2] ?? "/finance";
const base = process.argv[3] ?? "http://127.0.0.1:3000";

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
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

const html = await (await fetch(`${base}${path}`, { headers: { cookie } })).text();
const pattern = /\$\d{1,3}(?:,\d{3})*\.\d{2}/g;
const found = [...html.matchAll(pattern)];

console.log(`${path}: ${found.length} dollar-shaped amount(s) in ${html.length} bytes\n`);
for (const match of found) {
  const from = Math.max(0, match.index - 260);
  console.log(`--- ${match[0]} at byte ${match.index} ---`);
  console.log(html.slice(from, match.index + match[0].length + 120).replace(/\\n/g, " "));
  console.log();
}
