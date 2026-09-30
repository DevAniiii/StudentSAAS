import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "../db";

/**
 * Append-only audit trail.
 *
 * Written for events an operator may need to reconstruct: authentication
 * outcomes, permission denials, money movement, and any mutation that touches
 * another user's data. Never updated, never deleted.
 *
 * `record` never throws — an audit failure must not fail the request that
 * triggered it. The write is best-effort and its failure is logged loudly, but
 * the user's action still succeeds.
 */

export interface AuditInput {
  actorId?: string | null;
  action: string;
  resource?: string | null;
  resourceId?: string | null;
  outcome?: "SUCCESS" | "FAILURE" | "DENIED";
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function record(input: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        resource: input.resource ?? null,
        resourceId: input.resourceId ?? null,
        outcome: input.outcome ?? "SUCCESS",
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        // Cast rather than let the compiler fight: `metadata` is a
        // developer-supplied literal in every call site, and Prisma's
        // InputJsonValue is structurally hostile to `unknown` values.
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        component: "audit",
        action: input.action,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** Read side, for an admin view. Keyset-paginated on createdAt + id. */
export async function listRecent(options: {
  actorId?: string;
  actionPrefix?: string;
  take?: number;
  cursor?: { createdAt: Date; id: string } | null;
}) {
  const take = Math.min(options.take ?? 50, 200);

  return prisma.auditEvent.findMany({
    where: {
      ...(options.actorId ? { actorId: options.actorId } : {}),
      ...(options.actionPrefix ? { action: { startsWith: options.actionPrefix } } : {}),
    },
    include: { actor: { select: { email: true, firstName: true, lastName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    ...(options.cursor
      ? {
          cursor: { id: options.cursor.id },
          skip: 1,
        }
      : {}),
  });
}
