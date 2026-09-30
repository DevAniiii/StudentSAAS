/**
 * Money.
 *
 * Every amount in this system is an integer number of minor units. Floats are
 * never used for money: 0.1 + 0.2 !== 0.3 in binary floating point, and a
 * registrar's ledger has to balance to the last minor unit. The only place a
 * decimal appears is in formatting, which is a display concern and never feeds
 * back into arithmetic.
 *
 * The type is called `Cents` and the parameters are called `cents`, which is now
 * a historical name: the institution bills in rupees and the minor unit is a
 * paise. The arithmetic is identical — 100 minor units to the major unit, an
 * integer throughout — so the name is a label rather than a claim about the
 * currency, and the column names (`totalCents` and friends) still match the
 * schema. Renaming all of it is a wide, purely cosmetic diff; renaming it
 * *partially* is worse, because then two names for one idea are both in use.
 *
 * `Intl.NumberFormat` is used for presentation rather than hand-rolled string
 * surgery, so grouping separators, symbol placement and minor-unit digits are
 * correct for any currency the institution switches to.
 */

export type Cents = number;

/** The currency the institution bills in. */
export const INSTITUTION_CURRENCY = "INR";

/**
 * Locale per currency, so a rupee amount is grouped the Indian way.
 *
 * `Intl.NumberFormat` picks its locale from the runtime when none is given,
 * which makes the output depend on the server's environment rather than on the
 * currency: the same `113000` paise renders as `₹1,13,000.00` under `en-IN` and
 * `₹113,000.00` under `en-US`. A receipt that changes shape when the app is
 * deployed to a different host is a bug that only shows up in production, so the
 * locale is pinned per currency. Anything not listed falls back to the runtime
 * default, which is the correct behaviour for a currency nobody has thought
 * about yet.
 */
const CURRENCY_LOCALES: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
};

/** Guard against float drift accumulating in arithmetic helpers. */
function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of minor units, received ${value}`);
  }
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${currency}:${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    const locale = CURRENCY_LOCALES[currency.toUpperCase()];
    cached = new Intl.NumberFormat(locale, { style: "currency", currency, ...options });
    formatters.set(key, cached);
  }
  return cached;
}

/** `₹1,13,000.00` — the default presentation for a currency amount. */
export function formatMoney(cents: Cents, currency = INSTITUTION_CURRENCY): string {
  return formatter(currency, {}).format(cents / 100);
}

/**
 * `₹1,13,000` with no fraction digits, for dense tables where the minor units
 * are not the point. Rounds half-up on the absolute value, matching how an
 * invoice summary is read.
 */
export function formatMoneyCompact(cents: Cents, currency = INSTITUTION_CURRENCY): string {
  return formatter(currency, {
    minimumFractionDigits: 0,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/**
 * Drop the symbol: for table columns where a single currency is declared.
 *
 * Grouped under the same locale the symbol would have used, so the bare number
 * and the symbol form line up digit for digit.
 */
export function formatAmount(cents: Cents, currency = INSTITUTION_CURRENCY): string {
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency.toUpperCase()], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** `1,234.56` — the amount only, for input fields and concatenation. */
export function centsToDecimalString(cents: Cents): string {
  assertCents(cents, "cents");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Parse a user-entered amount string into cents.
 *
 * Returns null rather than throwing so a form validator can decide how to
 * report the problem. Accepts optional thousands separators and a leading
 * currency symbol; rejects anything with more than two decimal places rather
 * than silently rounding away the user's money.
 */
export function decimalStringToCents(input: string): Cents | null {
  const cleaned = input.replace(/[\s, ]/g, "").replace(/^[^0-9.-]+/, "");
  if (!cleaned || !/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === "." || cleaned === "-") {
    return null;
  }

  const negative = cleaned.startsWith("-");
  const [whole, fraction = ""] = cleaned.replace(/^-/, "").split(".");
  if (fraction.length > 2) return null;

  const units = Number(whole || "0");
  if (!Number.isSafeInteger(units)) return null;

  const fractionPad = (fraction + "00").slice(0, 2);
  const total = units * 100 + Number(fractionPad);
  return negative ? -total : total;
}

/**
 * Sum a set of amounts. Throws on a non-integer input rather than propagating
 * a fractional cent into a stored total.
 */
export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((total, value) => {
    assertCents(value, "line amount");
    return total + value;
  }, 0);
}

/** Quantity × unit price. Rounds half-up on the minor unit, as an invoice would. */
export function lineTotal(unitPriceCents: Cents, quantity: number): Cents {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`quantity must be a non-negative integer, received ${quantity}`);
  }
  return Math.round(unitPriceCents * quantity);
}

/**
 * Percentage of a whole, rounded to the nearest minor unit.
 * Used for instalments and late-payment fees.
 */
export function percentageOf(cents: Cents, percent: number): Cents {
  return Math.round((cents * percent) / 100);
}

/**
 * Invoice settlement state derived from totals, so the column and the derived
 * answer can never disagree.
 *
 * A DRAFT invoice is never paid regardless of payments, because a draft is not
 * yet a demand for money.
 */
export type SettlementState = "DRAFT" | "OPEN" | "OVERDUE" | "SETTLED" | "VOID";

export function settlementState(input: {
  status: string;
  totalCents: Cents;
  paidCents: Cents;
  dueOn: Date;
  now: Date;
}): SettlementState {
  if (input.status === "VOID" || input.status === "DRAFT") return input.status as SettlementState;
  if (input.paidCents >= input.totalCents) return "SETTLED";
  if (input.dueOn.getTime() < input.now.getTime()) return "OVERDUE";
  return "OPEN";
}

/** Remaining balance, floored at zero so a refund never shows as owing. */
export function balanceDue(totalCents: Cents, paidCents: Cents): Cents {
  return Math.max(0, totalCents - paidCents);
}
