import { z } from "zod";
import { route, created, parseJson } from "@/lib/http/responses";
import { AppError } from "@/lib/http/errors";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireApiUser } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/security/csrf";
import { hit, rateKey } from "@/lib/security/rate-limit";
import { record } from "@/lib/security/audit";
import { requireMessageRecipient } from "@/server/comms";

export const runtime = "nodejs";

/**
 * POST /api/v1/messages
 *
 * Sends a message, or replies within an existing thread.
 *
 * The authorisation is the whole design of this endpoint, and it is enforced by
 * re-derivation rather than by trusting the request:
 *
 *  - **`recipientId` is checked against the sender's own enrolments.** The client
 *    offers a dropdown built from that same list, which is a convenience, not a
 *    control. If the server trusted the dropdown, any authenticated user could
 *    post a message into any account in the institute by editing a request body.
 *    `requireMessageRecipient` re-runs the derivation server-side, so the check
 *    cannot be skipped by not using the form.
 *  - **Replying is checked by participation, not by thread id.** A thread id in
 *    the body is a claim; the `threadParticipant` row is the fact. A student who
 *    is not in the thread gets 404, not 403 — "forbidden" would confirm the
 *    thread exists, and existence is itself a small disclosure.
 *
 * There is one query for the whole send. The thread is found, the recipient
 * confirmed, and the message written inside a transaction: a thread created and
 * then failed to accept its first message would leave an empty conversation in
 * the recipient's inbox, which reads as a bug and cannot be cleaned up by the
 * sender.
 *
 * `updatedAt` is bumped on the thread. It is the sort key for the inbox, and a
 * thread whose timestamp only moved when the thread was created would file new
 * replies at the position of the original.
 */

const body = z.object({
  recipientId: z.string().min(1, "Choose a recipient.").max(64),
  subject: z
    .string()
    .trim()
    .max(140, "Keep the subject under 140 characters.")
    // An empty subject is allowed and defaulted server-side, because a reply
    // often has none. The client sends "(no subject)" for the same reason.
    .default("(no subject)"),
  body: z
    .string()
    .trim()
    .min(1, "Write something before sending.")
    .max(5000, "Messages are limited to 5,000 characters."),
  threadId: z.string().min(1).max(64).optional(),
});

export const POST = route(async (request) => {
  await assertSameOrigin(request);
  const { user } = await requireApiUser();

  const limit = hit(rateKey("message", user.id), env.rateLimit.messageMaxPerHour, 60 * 60);
  if (!limit.allowed) throw AppError.rateLimited(limit.retryAfterSeconds);

  const parsed = await parseJson(request, body);

  // Re-derived server-side. See the doc comment: this is the authorisation.
  await requireMessageRecipient(user.id, parsed.recipientId);

  const result = await prisma.$transaction(async (tx) => {
    // `const` in both branches: the reply path uses the id it was given, the
    // new-thread path uses the one the database assigned. Neither is ever
    // reassigned, so a single `let` would be a lie about the control flow.
    if (parsed.threadId) {
      const participant = await tx.threadParticipant.findUnique({
        where: { threadId_userId: { threadId: parsed.threadId, userId: user.id } },
        select: { threadId: true },
      });
      // Same 404 for "no such thread" and "not yours". See the doc comment.
      if (!participant) throw AppError.notFound("Conversation");

      await tx.message.create({
        data: { threadId: parsed.threadId, senderId: user.id, body: parsed.body },
      });
      await tx.thread.update({
        where: { id: parsed.threadId },
        data: { updatedAt: new Date() },
      });
      return { threadId: parsed.threadId, created: false };
    }

    const thread = await tx.thread.create({
      data: {
        subject: parsed.subject,
        participants: { create: [{ userId: user.id }, { userId: parsed.recipientId }] },
        messages: { create: [{ senderId: user.id, body: parsed.body }] },
      },
      select: { id: true },
    });
    return { threadId: thread.id, created: true };
  });

  await record({
    actorId: user.id,
    action: "message.sent",
    resource: "thread",
    resourceId: result.threadId,
    metadata: { reply: !result.created, recipientId: parsed.recipientId },
  });

  return created({ threadId: result.threadId, created: result.created });
});
