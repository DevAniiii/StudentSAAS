// Does the rendered HTML say what it is supposed to say?
//
// The seed and the database can both be correct while the page still shows
// something else: a currency symbol from a stale default, a code formatted by
// the wrong helper, a name that survived a rename in one place and not another.
// None of that is visible from a query — the row is right and the output is
// wrong — so it is checked here against the actual markup a browser receives.
//
// Usage: node scripts/check-render.mjs [baseUrl]

const base = process.argv[2] ?? "http://127.0.0.1:3000";

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

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail && !ok ? `  — ${detail}` : ""}`);
}

async function page(path) {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  return { status: response.status, html: await response.text() };
}

console.log("\nstudent identity, as rendered");
for (const path of ["/today", "/term", "/settings", "/grades"]) {
  const { status, html } = await page(path);
  check(`${path} renders`, status === 200, `got ${status}`);
  check(`${path} shows the student code`, html.includes("BWU/BCA/24/359"));
  check(`${path} shows the student's name`, html.includes("Anirban"));
  check(`${path} shows the programme`, html.includes("BCA"));
  check(`${path} has no leftover seed identity`, !html.includes("Krishnan"));
}

// A dollar sign followed by any digit is not a dollar amount. React's
// server-component payload is full of `$`-prefixed references — `"$undefined"`,
// `"$1"`, `"$L8"`, `"$@e"` — and a naive `\$\d` matches those, which turns this
// into a check that fails on a correct page and gets deleted. So this matches the
// *shape* of a formatted amount: symbol, grouped digits, and a decimal point with
// exactly two places. Nothing in the RSC payload looks like that.
const DOLLAR_AMOUNT = /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})/;

console.log("\nmoney, as rendered");
const finance = await page("/finance");
check("/finance renders", finance.status === 200, `got ${finance.status}`);
check("/finance shows a rupee sign", finance.html.includes("₹"));
check("/finance shows the tuition instalment", finance.html.includes("28,500"));
check("/finance shows the paid laboratory invoice", finance.html.includes("15,500"));
check("/finance has no dollar amounts left", !DOLLAR_AMOUNT.test(finance.html), DOLLAR_AMOUNT.exec(finance.html)?.[0]);
check("/finance does not spell USD", !finance.html.includes("USD"));

const today = await page("/today");
check("/today shows a rupee sign", today.html.includes("₹"));
check("/today has no dollar amounts left", !DOLLAR_AMOUNT.test(today.html), DOLLAR_AMOUNT.exec(today.html)?.[0]);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
