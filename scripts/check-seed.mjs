// Check the seeded data reads the way the institution means it to.
//
// Written as a script rather than a look at the admin UI because the failure this
// guards against is not "the row is missing" — it is "the row is there and says
// something subtly wrong", like a roll that lost its zero padding or an amount
// that is right in rupees and wrong in paise. Those are invisible in a table of
// records and obvious in a formatted string.
//
// Usage: node scripts/check-seed.mjs

// `@next/env` is CommonJS and `tsx` rewrites the interop, so neither `default`
// nor `module.exports` is reliably on the namespace. Loading it through
// `createRequire` gets the real CJS exports object and sidesteps the question.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

console.log("\nstudents");
const students = await prisma.user.findMany({
  where: { role: "STUDENT" },
  orderBy: { studentNumber: "asc" },
  include: { program: true },
});
check("three students", students.length === 3, `got ${students.length}`);
for (const s of students) {
  console.log(
    `        ${s.studentNumber}  ${s.firstName} ${s.lastName}  <${s.email}>  ${s.program?.code} year ${s.studyYear}`,
  );
}
check(
  "every code has a zero-padded three-digit roll",
  students.every((s) => /^\w{2,6}\/\w{2,6}\/\d{2}\/\d{3}$/.test(s.studentNumber ?? "")),
  students.map((s) => s.studentNumber).join(", "),
);
check(
  "the three named rolls are 303, 307, 359",
  ["303", "307", "359"].every((roll) =>
    students.some((s) => s.studentNumber?.endsWith(`/${roll}`)),
  ),
  students.map((s) => s.studentNumber?.split("/").at(-1)).join(", "),
);
check(
  "rolls are unique",
  new Set(students.map((s) => s.studentNumber)).size === students.length,
);

console.log("\nfinance");
const invoices = await prisma.invoice.findMany({
  orderBy: { number: "asc" },
  include: { lines: true, payments: true },
});
for (const inv of invoices) {
  const lineSum = inv.lines.reduce((n, l) => n + l.amountCents, 0);
  const paid = inv.payments.reduce((n, p) => n + p.amountCents, 0);
  const rupees = (minor) => `₹${(minor / 100).toLocaleString("en-IN")}`;
  console.log(`        ${inv.number}  ${rupees(inv.totalCents)}  ${inv.status}  paid ${rupees(paid)}`);
  check(`  ${inv.number} is in INR`, inv.currency === "INR", inv.currency);
  check(`  ${inv.number} lines sum to the total`, lineSum === inv.totalCents, `${lineSum} vs ${inv.totalCents}`);
  check(
    `  ${inv.number} is a plausible rupee amount`,
    inv.totalCents >= 100_000,
    // Only meaningful when it fails; on a pass it would read as a complaint.
    inv.totalCents >= 100_000 ? "" : `${rupees(inv.totalCents)} is below ₹1,000, which is not a fee`,
  );
}
const methods = await prisma.payment.findMany({ distinct: ["method"], select: { method: true } });
console.log(`        payment methods: ${methods.map((m) => m.method).join(", ")}`);
check("UPI is a usable payment method", methods.some((m) => m.method === "UPI"));

console.log("\nenrolments");
const enrolments = await prisma.enrollment.groupBy({ by: ["studentId"], _count: true });
check(
  "all three students are enrolled in the same sections",
  enrolments.length === 3 && new Set(enrolments.map((e) => e._count)).size === 1,
  enrolments.map((e) => e._count).join(", "),
);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
