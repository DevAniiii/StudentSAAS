import { cn } from "@/lib/cn";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { Code } from "@/components/ui/badge";
import { Meter } from "@/components/ui/data-display";
import { formatMoney, type Cents } from "@/lib/money";
import {
  formatDayMonth,
  formatFullDate,
  formatRelativeDay,
  nearTerm,
} from "@/lib/dates";
import type { FinanceOverview, InvoiceView } from "@/server/finance";
import { settlementBadge } from "./vocabulary";

/**
 * The finance ledger.
 *
 * Structurally a ledger: a running position at the top, then the entries in
 * order of when they need attention, then the receipts that prove what has been
 * settled.
 *
 * The one non-obvious choice is the ordering. Invoices are sorted by *urgency*,
 * not by issue date or by number — overdue first, then by days remaining, then
 * settled ones last. An accounting system would sort by date; a student looking
 * at their fees does not, and the reordering is what makes the page answer a
 * question rather than present a record.
 *
 * Every amount is rendered through `formatMoney`, and every sum is done in cents
 * with integer arithmetic. There is no float anywhere near a currency value: the
 * totals on this page are the numbers that end up on a statement, and
 * `0.1 + 0.2` is not a defensible place to be inexact.
 */

/* -------------------------------------------------------------------------- */
/* Position                                                                    */
/* -------------------------------------------------------------------------- */

function PositionPanel({
  overview,
  currency,
  now,
  timezone,
}: {
  overview: FinanceOverview;
  currency: string;
  now: Date;
  timezone: string;
}) {
  const { totals } = overview;
  const clear = totals.outstandingCents === 0;

  // How far past due the *worst* invoice is, in whole days. Not the sum of the
  // arrears and not the earliest due date rendered as a string: the number a
  // bursar's office will ask for is "how late is the worst one", because that is
  // what determines whether a hold applies. Computed here rather than returned
  // by the query because it is a presentation of data already fetched, and a
  // derived column in a view is one more thing to keep correct.
  const worstOverdueDays = overview.invoices.reduce((worst, invoice) => {
    if (!invoice.isOverdue || invoice.daysUntilDue === null) return worst;
    return Math.max(worst, -invoice.daysUntilDue);
  }, 0);

  return (
    <Panel as="section" aria-labelledby="position">
      <PanelHeader
        id="position"
        title="Your position"
        description={
          clear
            ? "Nothing outstanding across any invoice."
            : `${overview.invoices.filter((invoice) => invoice.settlement === "SETTLED").length} of ${overview.invoices.length} invoices settled.`
        }
      />

      <dl className="grid gap-x-6 gap-y-5 px-4 py-4 sm:grid-cols-3">
        <div>
          <dt className="font-mono text-2xs uppercase tracking-[0.13em] text-ink-subtle">
            Outstanding
          </dt>
          <dd
            className={cn(
              "mt-1 font-mono text-2xl font-medium leading-none tracking-[-0.02em] tabular-nums",
              clear ? "text-accent" : "text-ink",
            )}
          >
            {formatMoney(totals.outstandingCents, currency)}
          </dd>
          {totals.nextDueOn ? (
            /* Both forms, because they answer different questions. The date is
               what you write on a bank transfer; the relative day is what tells
               you whether it needs doing this week. A date alone makes the
               student do that subtraction, and a relative day alone is useless
               to the bursar's office.

               The relative form is dropped when it would be a *second* date.
               `formatRelativeDay` deliberately falls back to an absolute date
               past 13 days, and "15 Oct · $400 · 15 Oct" is noise. */
            <p className="mt-1.5 text-2xs text-ink-muted">
              Next due{" "}
              <time dateTime={totals.nextDueOn.toISOString()}>
                {formatDayMonth(totals.nextDueOn, timezone)}
              </time>{" "}
              · {formatMoney(totals.nextDueCents, currency)}
              {nearTerm(totals.nextDueOn, now, timezone)
                ? ` · ${formatRelativeDay(totals.nextDueOn, now, timezone).toLowerCase()}`
                : ""}
            </p>
          ) : (
            <p className="mt-1.5 text-2xs text-ink-subtle">No future due dates</p>
          )}
        </div>

        <div>
          <dt className="font-mono text-2xs uppercase tracking-[0.13em] text-ink-subtle">
            Overdue
          </dt>
          <dd
            className={cn(
              "mt-1 font-mono text-2xl font-medium leading-none tracking-[-0.02em] tabular-nums",
              totals.overdueCents > 0 ? "text-danger-hover" : "text-ink",
            )}
          >
            {formatMoney(totals.overdueCents, currency)}
          </dd>
          <p className="mt-1.5 text-2xs text-ink-muted">
            {totals.overdueCount === 0
              ? "Nothing past its due date"
              : `Across ${totals.overdueCount} invoice${totals.overdueCount === 1 ? "" : "s"} · worst ${
                  worstOverdueDays === 1 ? "1 day" : `${worstOverdueDays} days`
                } past due`}
          </p>
        </div>

        <div>
          <dt className="font-mono text-2xs uppercase tracking-[0.13em] text-ink-subtle">
            Paid this term
          </dt>
          <dd className="mt-1 font-mono text-2xl font-medium leading-none tracking-[-0.02em] tabular-nums text-accent">
            {formatMoney(totals.paidThisTermCents, currency)}
          </dd>
          <p className="mt-1.5 text-2xs text-ink-muted">
            {overview.receipts.length} receipt
            {overview.receipts.length === 1 ? "" : "s"} on record
          </p>
        </div>
      </dl>

      {totals.overdueCents > 0 ? (
        <p className="border-t border-rule bg-danger-subtle px-4 py-3 text-xs leading-relaxed text-ink">
          <span className="font-medium text-danger-hover">
            {formatMoney(totals.overdueCents, currency)} is past its due date.
          </span>{" "}
          Overdue balances can affect your course registration for the following term. If you
          believe this is wrong — a payment made offline, a financial aid credit not yet applied —
          contact the bursar&apos;s office with the invoice number.
        </p>
      ) : null}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Invoices                                                                    */
/* -------------------------------------------------------------------------- */

export function FinanceLedger({
  overview,
  currency,
  now,
  timezone,
}: {
  overview: FinanceOverview;
  currency: string;
  now: Date;
  timezone: string;
}) {
  const { invoices } = overview;

  if (invoices.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No invoices"
          description="Nothing has been raised against your record. Fees, accommodation and any other charges appear here once the bursar's office issues them."
        />
      </Panel>
    );
  }

  const sorted = byUrgency(invoices);

  return (
    <div className="space-y-5">
      <PositionPanel
        overview={overview}
        currency={currency}
        now={now}
        timezone={timezone}
      />

      <section aria-labelledby="invoices">
        <h2
          id="invoices"
          className="mb-3 font-mono text-2xs uppercase tracking-[0.14em] text-ink-subtle"
        >
          Invoices
        </h2>
        <div className="space-y-3">
          {sorted.map((invoice) => (
            <InvoiceCard
              key={invoice.id}
              invoice={invoice}
              now={now}
              timezone={timezone}
            />
          ))}
        </div>
      </section>

      <ReceiptsPanel overview={overview} currency={currency} timezone={timezone} />

      <p className="px-1 text-2xs leading-relaxed text-ink-subtle">
        Payments are recorded by the bursar&apos;s office, not by this portal. If you have paid and
        the balance here has not changed, allow two working days before raising it — and quote the
        receipt number, which is generated when the payment is recorded.
      </p>
    </div>
  );
}

/** Overdue, then soonest due, then settled and void last. */
function byUrgency(invoices: InvoiceView[]): InvoiceView[] {
  return [...invoices].sort((a, b) => {
    const aDone = a.settlement === "SETTLED" || a.settlement === "VOID";
    const bDone = b.settlement === "SETTLED" || b.settlement === "VOID";
    if (aDone !== bDone) return aDone ? 1 : -1;

    const rank = (invoice: InvoiceView) =>
      invoice.settlement === "OVERDUE" ? 0 : invoice.settlement === "OPEN" ? 1 : 2;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);

    // Then by due date. `getTime` rather than `<`, because either date may be
    // null and comparison operators coerce rather than order.
    const left = a.dueOn.getTime();
    const right = b.dueOn.getTime();
    if (left !== right) return left - right;
    return a.number.localeCompare(b.number);
  });
}

function InvoiceCard({
  invoice,
  now,
  timezone,
}: {
  invoice: InvoiceView;
  now: Date;
  timezone: string;
}) {
  const settled = invoice.settlement === "SETTLED";
  const partial = invoice.paidCents > 0 && invoice.balanceCents > 0;
  const paidPercent =
    invoice.totalCents > 0 ? (invoice.paidCents / invoice.totalCents) * 100 : 0;

  return (
    <Panel as="article" aria-labelledby={`inv-${invoice.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <Code>{invoice.number}</Code>
            {settlementBadge(invoice.settlement)}
            {invoice.termName ? (
              <span className="font-mono text-2xs text-ink-subtle">{invoice.termName}</span>
            ) : null}
          </div>
          <h3
            id={`inv-${invoice.id}`}
            className="mt-1 truncate text-sm font-semibold text-ink"
          >
            {invoice.lines[0]?.description ?? "Invoice"}
            {invoice.lines.length > 1 ? (
              <span className="ml-1.5 font-normal text-ink-muted">
                and {invoice.lines.length - 1} other item
                {invoice.lines.length - 1 === 1 ? "" : "s"}
              </span>
            ) : null}
          </h3>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-lg font-medium leading-none tabular-nums text-ink">
            {formatMoney(invoice.totalCents, invoice.currency)}
          </p>
          {!settled ? (
            <p
              className={cn(
                "mt-1 font-mono text-2xs tabular-nums",
                invoice.isOverdue ? "text-danger-hover" : "text-ink-muted",
              )}
            >
              {formatMoney(invoice.balanceCents, invoice.currency)} remaining
            </p>
          ) : (
            <p className="mt-1 font-mono text-2xs tabular-nums text-accent">Settled in full</p>
          )}
        </div>
      </div>

      {partial ? (
        <div className="border-b border-rule px-4 py-2.5">
          <Meter
            value={paidPercent}
            size="sm"
            label={`${Math.round(paidPercent)} per cent of invoice ${invoice.number} paid`}
          />
          <p className="mt-1.5 font-mono text-2xs tabular-nums text-ink-muted">
            {formatMoney(invoice.paidCents, invoice.currency)} paid ·{" "}
            {formatMoney(invoice.balanceCents, invoice.currency)} remaining
          </p>
        </div>
      ) : null}

      {/* Line items. Collapsed by default once there are more than three, because
          an itemised list is reference material — most visits are "how much do I
          owe", which the header above already answers. */}
      <div className="border-b border-rule">
        {invoice.lines.length > 3 ? (
          <details className="group">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-medium text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
              <span className="group-open:hidden">
                Show {invoice.lines.length} line items
              </span>
              <span className="hidden group-open:inline">Hide line items</span>
            </summary>
            <LineItems invoice={invoice} />
          </details>
        ) : (
          <LineItems invoice={invoice} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2.5">
        <p className="font-mono text-2xs text-ink-muted">
          Issued {formatDayMonth(invoice.issuedOn, timezone)} · due{" "}
          <time
            dateTime={invoice.dueOn.toISOString()}
            className={cn(
              invoice.isOverdue ? "text-danger-hover" : undefined,
            )}
          >
            {formatDayMonth(invoice.dueOn, timezone)}
          </time>
          {invoice.isOverdue ? (
            <span className="text-danger-hover">
              {" "}
              · {formatRelativeDay(invoice.dueOn, now, timezone)}
            </span>
          ) : invoice.settlement === "OPEN" && invoice.daysUntilDue !== null ? (
            <span className="text-ink-subtle">
              {" "}
              · {formatRelativeDay(invoice.dueOn, now, timezone)}
            </span>
          ) : null}
        </p>
        {invoice.notes ? (
          <p className="max-w-[40ch] text-2xs leading-relaxed text-ink-subtle">
            {invoice.notes}
          </p>
        ) : null}
      </div>

      {invoice.payments.length > 0 ? (
        <div className="border-t border-rule bg-well px-4 py-2.5">
          <p className="font-mono text-2xs uppercase tracking-[0.12em] text-ink-subtle">
            Payments
          </p>
          <ul className="mt-1.5 space-y-1">
            {invoice.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-2xs tabular-nums text-ink">
                  {formatMoney(payment.amountCents, invoice.currency)}
                </span>
                <span className="font-mono text-2xs text-ink-subtle">
                  {payment.receiptNo} · {formatFullDate(payment.paidAt, timezone)}
                </span>
                <span className="text-2xs text-ink-muted">
                  {payment.method.toLowerCase().replace(/_/g, " ")}
                  {payment.reference ? ` · ${payment.reference}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function LineItems({ invoice }: { invoice: InvoiceView }) {
  return (
    <table className="w-full text-left">
      <caption className="sr-only">
        Line items on invoice {invoice.number}
      </caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Description</th>
          <th scope="col">Quantity</th>
          <th scope="col">Unit price</th>
          <th scope="col">Amount</th>
        </tr>
      </thead>
      <tbody>
        {invoice.lines.map((line) => (
          <tr key={line.id} className="border-b border-rule last:border-b-0">
            <th
              scope="row"
              className="px-4 py-2 text-left text-xs font-normal text-ink-muted"
            >
              <span className="block">{line.description}</span>
              {line.category ? (
                <span className="block font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-subtle">
                  {line.category.toLowerCase().replace(/_/g, " ")}
                </span>
              ) : null}
            </th>
            <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-2xs tabular-nums text-ink-subtle">
              {line.quantity} × {formatMoney(line.unitPriceCents, invoice.currency)}
            </td>
            <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums text-ink">
              {formatMoney(line.amountCents, invoice.currency)}
            </td>
          </tr>
        ))}
      </tbody>
      {invoice.taxCents > 0 ? (
        <tfoot>
          <tr>
            <th scope="row" className="px-4 py-2 text-left text-xs font-normal text-ink-muted">
              Tax
            </th>
            <td />
            <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums text-ink">
              {formatMoney(invoice.taxCents, invoice.currency)}
            </td>
          </tr>
          <tr>
            <th
              scope="row"
              className="border-t border-rule px-4 py-2 text-left text-xs font-semibold text-ink"
            >
              Total
            </th>
            <td />
            <td className="whitespace-nowrap border-t border-rule px-4 py-2 text-right font-mono text-sm font-medium tabular-nums text-ink">
              {formatMoney(invoice.totalCents, invoice.currency)}
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

/* -------------------------------------------------------------------------- */
/* Receipts                                                                    */
/* -------------------------------------------------------------------------- */

function ReceiptsPanel({
  overview,
  currency,
  timezone,
}: {
  overview: FinanceOverview;
  currency: string;
  timezone: string;
}) {
  const { receipts } = overview;
  if (receipts.length === 0) {
    return (
      <Panel as="section" aria-labelledby="receipts">
        <PanelHeader id="receipts" title="Receipts" />
        <EmptyState
          compact
          title="No payments recorded"
          description="Receipts appear here once the bursar's office records a payment against your account."
        />
      </Panel>
    );
  }

  // Subtotalled by method, because "how much did I pay by card" is a question
  // students ask and the receipt list does not answer it on its own.
  const byMethod = new Map<string, Cents>();
  for (const receipt of receipts) {
    byMethod.set(
      receipt.method,
      (byMethod.get(receipt.method) ?? 0) + receipt.amountCents,
    );
  }

  return (
    <Panel as="section" aria-labelledby="receipts">
      <PanelHeader
        id="receipts"
        title="Receipts"
        description={`Payments recorded in the last 90 days · ${receipts.length} receipt${receipts.length === 1 ? "" : "s"}`}
      />

      <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-b border-rule px-4 py-2.5">
        {[...byMethod.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([method, cents]) => (
            <p key={method} className="font-mono text-2xs text-ink-muted">
              <span className="text-ink-subtle">{method.toLowerCase().replace(/_/g, " ")}</span>{" "}
              <span className="tabular-nums text-ink">{formatMoney(cents, currency)}</span>
            </p>
          ))}
      </div>

      <ul className="divide-y divide-rule">
        {receipts.map((receipt) => (
          <li
            key={receipt.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
          >
            <span className="w-20 shrink-0 font-mono text-xs tabular-nums text-ink">
              {formatMoney(receipt.amountCents, receipt.currency)}
            </span>
            <span className="font-mono text-2xs text-ink-muted">{receipt.receiptNo}</span>
            <time
              dateTime={receipt.paidAt.toISOString()}
              className="font-mono text-2xs tabular-nums text-ink-subtle"
            >
              {formatDayMonth(receipt.paidAt, timezone)}
            </time>
            {receipt.invoiceNumber ? (
              <span className="text-2xs text-ink-muted">against {receipt.invoiceNumber}</span>
            ) : (
              <span className="text-2xs text-ink-subtle">unallocated</span>
            )}
            {receipt.reference ? (
              <span className="text-2xs text-ink-subtle">{receipt.reference}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
