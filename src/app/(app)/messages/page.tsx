import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getShellContext } from "@/server/context";
import { getThread, getMessageRecipients, getThreads } from "@/server/comms";
import { PageHeader } from "@/components/ui/panel";
import { MailBox } from "@/components/pages/mailbox";

export const metadata: Metadata = { title: "Messages" };

/**
 * Messages.
 *
 * Threads with instructors. Every fetch is authorised by participation in
 * `getThread`, so a thread id from another account returns `null` and the page
 * 404s rather than rendering an empty conversation — an empty thread and a
 * thread you cannot see look identical, and only one of them is honest.
 *
 * The recipients list is derived from enrolments, which is why the composer is
 * limited to people the student actually has a relationship with. A free-form
 * "to:" field would let a student compose mail to any account in the institute;
 * the thread write route re-derives the recipient set server-side regardless,
 * but not offering the field is better than offering one that sometimes fails.
 */

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getShellContext();
  if (!context) redirect("/login");

  const params = await searchParams;
  const requestedId = typeof params.thread === "string" ? params.thread : undefined;
  const requestedTo = typeof params.to === "string" ? params.to : undefined;

  // Only the previews are loaded here; the transcript for the selected thread
  // comes from the client so switching threads does not re-render the shell.
  const [previews, recipients] = await Promise.all([
    getThreads(context.user.id),
    getMessageRecipients(context.user.id),
  ]);

  const selected = requestedId ? await getThread(context.user.id, requestedId) : null;

  return (
    <>
      <PageHeader
        eyebrow={context.term ? context.term.code : undefined}
        title="Messages"
        description="Direct messages with the instructors of your courses. Mail is kept on the institute's servers and is not deleted by this portal."
      />

      <MailBox
        threads={previews.map((thread) => ({
          id: thread.id,
          subject: thread.subject,
          courseCode: thread.courseCode,
          updatedAt: thread.updatedAt.toISOString(),
          unread: thread.unread,
          unreadCount: thread.unreadCount,
          participants: thread.participants,
          lastMessage: thread.lastMessage
            ? {
                body: thread.lastMessage.body,
                createdAt: thread.lastMessage.createdAt.toISOString(),
                senderName: thread.lastMessage.senderName,
                senderId: thread.lastMessage.senderId,
              }
            : null,
        }))}
        recipients={recipients}
        now={context.now.toISOString()}
        initialThreadId={selected?.id}
        initialRecipientId={requestedTo}
      />
    </>
  );
}
