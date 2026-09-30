import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/db";
import { balanceDue, settlementState, type SettlementState } from "@/lib/money";
import { sumCents } from "@/lib/money";

/**
 * Finance data access.
 *
 * Money is read as integer cents throughout; only `formatMoney` ever divides by
 * a hundred. An invoice's settlement state is derived from its payments rather
 * than trusted from its `status` column, because the two drift — a payment
 * recorded offline leaves a `PAID` invoice that is actually short.
 */

export interface InvoiceView {
  id: string;
  number: string;
  status: string;
  issuedOn: Date;
  dueOn: Date;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  /** Derived, never stored. */
  settlement: SettlementState;
  notes: string | null;
  termName: string | null;
  daysUntilDue: number | null;
  isOverdue: boolean;
  lines: {
    id: string;
    description: string;
    category: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
  }[];
  payments: {
    id: string;
    receiptNo: string;
    amountCents: number;
    method: string;
    reference: string | null;
    paidAt: Date;
  }[];
}

export interface FinanceOverview {
  invoices: InvoiceView[];
  totals: {
    outstandingCents: number;
    overdueCents: number;
    overdueCount: number;
    paidThisTermCents: number;
    nextDueOn: Date | null;
    nextDueCents: number;
  };
  /** Payments in the last 90 days, most recent first. */
  receipts: {
    id: string;
    receiptNo: string;
    amountCents: number;
    currency: string;
    method: string;
    reference: string | null;
    paidAt: Date;
    invoiceNumber: string | null;
  }[];
}

export const getFinanceOverview = cache(
  async (studentId: string, now: Date): Promise<FinanceOverview> => {
    const invoices = await prisma.invoice.findMany({
      where: { studentId, status: { not: "VOID" } },
      orderBy: [{ dueOn: "asc" }],
      select: {
        id: true,
        number: true,
        status: true,
        issuedOn: true,
        dueOn: true,
        currency: true,
        subtotalCents: true,
        taxCents: true,
        totalCents: true,
        notes: true,
        term: { select: { name: true } },
        lines: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            description: true,
            category: true,
            quantity: true,
            unitPriceCents: true,
            amountCents: true,
          },
        },
        payments: {
          orderBy: { paidAt: "desc" },
          select: {
            id: true,
            receiptNo: true,
            amountCents: true,
            method: true,
            reference: true,
            paidAt: true,
          },
        },
      },
    });

    const views: InvoiceView[] = invoices.map((invoice) => {
      const paidCents = sumCents(invoice.payments.map((payment) => payment.amountCents));
      const balance = balanceDue(invoice.totalCents, paidCents);
      const settlement = settlementState({
        status: invoice.status,
        totalCents: invoice.totalCents,
        paidCents,
        dueOn: invoice.dueOn,
        now,
      });

      return {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        issuedOn: invoice.issuedOn,
        dueOn: invoice.dueOn,
        currency: invoice.currency,
        subtotalCents: invoice.subtotalCents,
        taxCents: invoice.taxCents,
        totalCents: invoice.totalCents,
        paidCents,
        balanceCents: balance,
        settlement,
        notes: invoice.notes,
        termName: invoice.term?.name ?? null,
        daysUntilDue: Math.floor((invoice.dueOn.getTime() - now.getTime()) / 86_400_000),
        isOverdue: settlement === "OVERDUE",
        lines: invoice.lines,
        payments: invoice.payments,
      };
    });

    const open = views.filter(
      (invoice) => invoice.settlement === "OPEN" || invoice.settlement === "OVERDUE",
    );
    const overdue = open.filter((invoice) => invoice.settlement === "OVERDUE");
    const next = open.find((invoice) => invoice.settlement === "OPEN") ?? null;

    const receipts = await prisma.payment.findMany({
      where: { studentId },
      orderBy: { paidAt: "desc" },
      take: 40,
      select: {
        id: true,
        receiptNo: true,
        amountCents: true,
        currency: true,
        method: true,
        reference: true,
        paidAt: true,
        invoice: { select: { number: true } },
      },
    });

    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
    const paidThisTermCents = sumCents(
      receipts
        .filter((receipt) => receipt.paidAt >= ninetyDaysAgo)
        .map((receipt) => receipt.amountCents),
    );

    return {
      invoices: views,
      totals: {
        outstandingCents: sumCents(open.map((invoice) => invoice.balanceCents)),
        overdueCents: sumCents(overdue.map((invoice) => invoice.balanceCents)),
        overdueCount: overdue.length,
        paidThisTermCents,
        nextDueOn: next?.dueOn ?? null,
        nextDueCents: next?.balanceCents ?? 0,
      },
      receipts: receipts.map((receipt) => ({
        id: receipt.id,
        receiptNo: receipt.receiptNo,
        amountCents: receipt.amountCents,
        currency: receipt.currency,
        method: receipt.method,
        reference: receipt.reference,
        paidAt: receipt.paidAt,
        invoiceNumber: receipt.invoice?.number ?? null,
      })),
    };
  },
);

/**
 * A single invoice, authorised by ownership.
 *
 * Returns null for both "does not exist" and "is not yours", so the endpoint
 * cannot be used to enumerate invoice ids.
 */
export const getInvoice = cache(
  async (studentId: string, invoiceId: string, now: Date): Promise<InvoiceView | null> => {
    const overview = await getFinanceOverview(studentId, now);
    return overview.invoices.find((invoice) => invoice.id === invoiceId) ?? null;
  },
);

/** Human-facing next receipt number. Not a security boundary — uniqueness is. */
export async function nextReceiptNo(): Promise<string> {
  const latest = await prisma.payment.findFirst({
    orderBy: { receiptNo: "desc" },
    select: { receiptNo: true },
  });
  const lastNumber = latest ? Number.parseInt(latest.receiptNo.replace(/\D+/g, ""), 10) : 88000;
  const next = Number.isFinite(lastNumber) ? lastNumber + 1 : 88001;
  return `RCPT-${next}`;
}
