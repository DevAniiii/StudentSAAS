import { route, ok } from "@/lib/http/responses";
import { AppError } from "@/lib/http/errors";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { record } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * GET /api/v1/messages/[threadId]
 *
 * One thread's messages, oldest first.
 *
 * Authorisation is by participation, checked before the read. A student who is
 * not a participant gets 404, not 403 — "forbidden" confirms the thread exists,
 * and in an institute-wide system the set of existing threads is itself
 * information worth not handing out.
 *
 * Marking as read happens here, in the same request that fetches the body,
 * because the user has demonstrably just read it — and the alternative is a
 * second round trip that a client will sometimes skip, leaving a badge on a
 * thread that has been read. The write is a single-column upsert on a composite
 * primary key, so it cannot duplicate.
 *
 * The cutoff is the newest message from *somebody else*. Marking the newest
 * message in the thread regardless of who sent it would clear the sender's own
 * unread badge the moment they re-opened a thread they had already read, and
 * that badge is usually the reason they re-opened it.
 */

// `Args` is the rest-tuple Next.js passes after the request, which for a dynamic
// segment is a single context object rather than positional params. `params` is
// a Promise in Next 15 — awaited here, once, rather than at each use.
export const GET = route<[{ params: Promise<{ threadId: string }> }]>(async (_request, { params }) => {
  const { threadId } = await params;
  const { user } = await requireApiUser();

  const participation = await prisma.threadParticipant.findUnique({
    where: { threadId_userId: { threadId, userId: user.id } },
    select: { lastReadAt: true },
  });
  if (!participation) throw AppError.notFound("Conversation");

  const messages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      createdAt: true,
      editedAt: true,
      senderId: true,
      sender: {
        select: { firstName: true, lastName: true, title: true, avatarHue: true },
      },
    },
  });

  // Newest message that is not the reader's own. `reduce` rather than `findLast`
  // so the intent is explicit and this does not depend on the ES2023 helper
  // being in the lib set.
  const newestInbound = messages.reduce<Date | null>((latest, message) => {
    if (message.senderId === user.id) return latest;
    return latest === null || message.createdAt > latest ? message.createdAt : latest;
  }, null);

  if (newestInbound && (participation.lastReadAt === null || participation.lastReadAt < newestInbound)) {
    await prisma.threadParticipant
      .update({
        where: { threadId_userId: { threadId, userId: user.id } },
        data: { lastReadAt: newestInbound },
      })
      .catch((error: unknown) => {
        // A failed read-marker write must not fail the read. The worst outcome is
        // a badge that reappears on the next load, which is strictly better than
        // losing the message history because a counter did not move.
        console.error(
          JSON.stringify({
            level: "warn",
            component: "messages",
            action: "mark-read-failed",
            threadId,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      });
  }

  await record({
    actorId: user.id,
    action: "message.thread.read",
    resource: "thread",
    resourceId: threadId,
    metadata: { count: messages.length },
  });

  return ok(
    {
      threadId,
      messages: messages.map((message) => {
        const name = `${message.sender.title ? `${message.sender.title} ` : ""}${message.sender.firstName} ${message.sender.lastName}`.trim();
        return {
          id: message.id,
          body: message.body,
          // ISO strings, not Dates. The client re-parses these to format
          // relative times, and a Date crossing the server/client boundary is a
          // silent source of hydration mismatches when the two clocks differ.
          createdAt: message.createdAt.toISOString(),
          editedAt: message.editedAt ? message.editedAt.toISOString() : null,
          senderId: message.senderId,
          senderName: name,
          senderTitle: message.sender.title,
          senderHue: message.sender.avatarHue,
          isSelf: message.senderId === user.id,
        };
      }),
    },
  );
});
