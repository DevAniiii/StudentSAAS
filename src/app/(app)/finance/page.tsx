import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getShellContext } from "@/server/context";
import { getFinanceOverview } from "@/server/finance";
import { INSTITUTION_CURRENCY } from "@/lib/money";
import { PageHeader } from "@/components/ui/panel";
import { FinanceLedger } from "@/components/pages/finance-ledger";

export const metadata: Metadata = { title: "Finance" };

/**
 * Finance.
 *
 * Written as a ledger rather than a checkout, because this is not a shop. Nobody
 * here is browsing; the two questions are "what do I owe, and by when" and "what
 * have I already paid, and can I see proof". Both are answered by a running
 * balance and a receipt list.
 *
 * Consequences that follow from that framing:
 *
 *  - **Invoices come first, receipts second.** Money owed is actionable; money
 *    already moved is a record.
 *  - **Amounts are always shown as received and as remaining.** An invoice marked
 *    paid in the system but short by a part payment is the exact failure mode a
 *    student gets burned by, so `paid / balance` is always visible together
 *    rather than derived.
 *  - **Overdue is separated from outstanding** with its own total. Both are
 *    "unpaid", but only one has consequences, and merging them hides that.
 *  - **Nothing here pretends to take a payment.** A link to the registrar's
 *    payment portal, with the real URL, or an honest statement that no online
 *    payment is configured. A disabled button labelled "Pay now" is worse than
 *    no button.
 */

export default async function FinancePage() {
  const context = await getShellContext();
  if (!context) redirect("/login");

  const finance = await getFinanceOverview(context.user.id, context.now);
  const currency = finance.invoices[0]?.currency ?? INSTITUTION_CURRENCY;

  return (
    <>
      <PageHeader
        eyebrow={context.term ? context.term.code : undefined}
        title="Finance"
        description="Invoices raised against your record, and receipts for payments made. Amounts are shown as issued and as remaining."
      />

      <FinanceLedger
        overview={finance}
        currency={currency}
        now={context.now}
        timezone={context.timezone}
      />
    </>
  );
}
