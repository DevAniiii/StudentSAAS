import { z } from "zod";
import { route, ok, parseJson } from "@/lib/http/responses";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/security/csrf";
import { record } from "@/lib/security/audit";

export const runtime = "nodejs";

/**
 * POST /api/v1/messages/read
 *
 * Marks a thread read, when the read happened without a transcript fetch.
 *
 * The GET on `/messages/[threadId]` already marks the open thread read, so this
 * exists for one case: a thread the user *opened from the list* without the
 * transcript arriving — a slow network, a failed fetch, a click on a row that
 * renders the preview. The badge has to go regardless, or the same thread shows
 * unread forever.
 *
 * The write is a plain `updateMany` on the composite key with a `lastReadAt`
 * set to *now* rather than to the newest inbound message. The difference matters
 * in one direction only: a real transcript fetch sets the marker to the message
 * time, so a message that arrives while the page is open still counts as unread.
 * Setting it to `now` here would swallow anything that landed in between. Since
 * this path has already shown the user the thread's preview — the latest message
 * they have seen — "as of now" is exactly the right claim, and it is not a lie
 * about a message that arrived afterwards.
 *
 * A thread the user does not participate in updates zero rows and returns
 * `marked: 0`. Not a 404: this is a badge-clearing side effect, and a
 * navigation that clears a badge should not be able to probe for thread
 * existence.
 */

const body = z.object({
  threadId: z.string().min(1).max(64),
});

export const POST = route(async (request) => {
  await assertSameOrigin(request);
  const { user } = await requireApiUser();
  const parsed = await parseJson(request, body);

  const now = new Date();
  const { count } = await prisma.threadParticipant.updateMany({
    // `userId` in the filter, not just the composite key: without it this would
    // happily set someone else's read marker for a thread they are in.
    where: { threadId: parsed.threadId, userId: user.id },
    data: { lastReadAt: now },
  });

  if (count > 0) {
    await record({
      actorId: user.id,
      action: "message.thread.marked_read",
      resource: "thread",
      resourceId: parsed.threadId,
    });
  }

  return ok({ marked: count });
});
