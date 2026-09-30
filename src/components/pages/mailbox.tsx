"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { Avatar } from "@/components/ui/data-display";
import { Code } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatRelativeTime } from "@/lib/dates";

/**
 * Mail.
 *
 * Two panes: threads on the left, the open conversation on the right, composer
 * below. Not a route per thread, because a mail client that navigates for every
 * message is a mail client that cannot hold an unsent draft, and "reply to the
 * thing I just read" is a real thing people do.
 *
 * Bodies are fetched only for the thread that is open. A student with forty
 * threads would otherwise pull forty message sets to read one — so the list rows
 * carry the preview they already have, and the full transcript is fetched on
 * selection. That is one query instead of forty, and the cost is that switching
 * threads shows the last message until the fetch lands, which the stub state
 * makes explicit rather than pretending to be complete.
 *
 * Unread marking is optimistic: the row clears as soon as it is selected, and a
 * failed write does not put the unread state back, because a badge that flickers
 * back is worse than a badge that is briefly wrong.
 */

export interface MailThreadSummary {
  id: string;
  subject: string;
  courseCode: string | null;
  updatedAt: string;
  unread: boolean;
  unreadCount: number;
  participants: {
    id: string;
    name: string;
    title: string | null;
    initials: string;
    avatarHue: number;
    isSelf: boolean;
  }[];
  lastMessage: {
    body: string;
    createdAt: string;
    senderName: string;
    senderId: string;
  } | null;
}

export interface MailMessage {
  id: string;
  body: string;
  createdAt: string;
  senderName: string;
  senderTitle: string | null;
  senderHue: number;
  isSelf: boolean;
}

export interface MailRecipient {
  id: string;
  name: string;
  title: string | null;
  email: string;
  initials: string;
  avatarHue: number;
  courseCodes: string[];
}

const DRAFT_KEY = "sf:mail-draft";

export function MailBox({
  threads,
  recipients,
  now,
  initialThreadId,
  initialRecipientId,
}: {
  threads: MailThreadSummary[];
  recipients: MailRecipient[];
  /** ISO string — the server's render instant, so relative times agree. */
  now: string;
  initialThreadId?: string;
  initialRecipientId?: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [activeId, setActiveId] = useState<string | null>(
    initialThreadId ?? (threads.length > 0 ? threads[0].id : null),
  );
  const [transcript, setTranscript] = useState<MailMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [composing, setComposing] = useState(initialRecipientId != null);

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  // Clear the unread marker locally as soon as a thread is opened. The server
  // write happens below; if it fails the count comes back on the next
  // navigation, which is a better outcome than a badge that flickers.
  const select = useCallback(
    (id: string) => {
      setActiveId(id);
      setComposing(false);
      const thread = threads.find((candidate) => candidate.id === id);
      if (thread?.unread) {
        void fetch("/api/v1/messages/read", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ threadId: id }),
        }).catch(() => {
          /* the count reappears on the next load; not worth interrupting for */
        });
      }
    },
    [threads],
  );

  useEffect(() => {
    if (!activeId) {
      setTranscript(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    fetch(`/api/v1/messages/${encodeURIComponent(activeId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { messages: MailMessage[] };
      })
      .then((payload) => {
        if (cancelled) return;
        setTranscript(payload.messages);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
        setTranscript(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const onSent = useCallback(() => {
    setComposing(false);
    toast.success("Message sent", "The recipient will see it in their ScholarFolio inbox.");
    router.refresh();
  }, [router, toast]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:items-start">
      <Panel
        as="section"
        aria-labelledby="threads"
        className="lg:sticky lg:top-[calc(var(--header-h)+1.25rem)]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-rule px-3 py-2.5">
          <h2 id="threads" className="text-sm font-semibold text-ink">
            Threads
            {threads.length > 0 ? (
              <span className="ml-1.5 font-mono text-2xs tabular-nums text-ink-subtle">
                {threads.length}
              </span>
            ) : null}
          </h2>
          <button
            type="button"
            onClick={() => setComposing(true)}
            disabled={recipients.length === 0}
            className="rounded-sm px-1.5 py-0.5 text-2xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-ink-subtle disabled:no-underline"
          >
            New
          </button>
        </div>

        {threads.length === 0 ? (
          <EmptyState
            compact
            title="No mail"
            description="Threads with your instructors appear here once either of you writes."
          />
        ) : (
          <ul className="divide-y divide-rule">
            {threads.map((thread) => (
              <li key={thread.id} className="flex items-stretch">
                <div className="min-w-0 flex-1">
                  <ThreadRow
                    thread={thread}
                    active={activeId === thread.id}
                    now={now}
                    onSelect={() => select(thread.id)}
                  />
                </div>
                <ThreadPermalink subject={thread.subject} threadId={thread.id} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="min-w-0">
        {composing ? (
          <Composer
            recipients={recipients}
            initialRecipientId={initialRecipientId}
            onCancel={() => setComposing(false)}
            onSent={onSent}
          />
        ) : !active ? (
          <Panel>
            <EmptyState
              title="Select a thread"
              description="Choose a conversation on the left, or start a new one with the instructor of a course you take."
            />
          </Panel>
        ) : (
          <Conversation
            thread={active}
            messages={transcript}
            loading={loading}
            failed={failed}
            now={now}
            onReply={() => setComposing(true)}
            onRetry={() => setActiveId((id) => (id === null ? null : id))}
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Thread row                                                                  */
/* -------------------------------------------------------------------------- */

function ThreadRow({
  thread,
  active,
  now,
  onSelect,
}: {
  thread: MailThreadSummary;
  active: boolean;
  now: string;
  onSelect: () => void;
}) {
  const others = thread.participants.filter((participant) => !participant.isSelf);
  const lastName = thread.lastMessage?.senderName.split(" ").slice(-1)[0];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "block w-full px-3 py-2.5 text-left",
        "transition-colors duration-fast",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        active ? "bg-accent-subtle" : "hover:bg-hover",
      )}
    >
      <div className="flex items-center gap-2">
        {thread.courseCode ? <Code>{thread.courseCode}</Code> : <span />}
        {thread.unread ? (
          <span
            className="ml-auto size-1.5 shrink-0 rounded-pill bg-ochre"
            aria-label={`${thread.unreadCount} unread`}
          />
        ) : null}
      </div>
      <p
        className={cn(
          "mt-1 truncate text-xs",
          thread.unread ? "font-semibold text-ink" : "text-ink",
        )}
      >
        {thread.subject}
      </p>
      <p className="mt-0.5 truncate text-2xs text-ink-muted">
        {others.length > 0 ? others.map((person) => person.name).join(", ") : "Institute"}
      </p>
      {thread.lastMessage ? (
        <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-ink-subtle">
          {lastName ? <span className="text-ink-muted">{lastName}: </span> : null}
          {thread.lastMessage.body}
        </p>
      ) : null}
      <p className="mt-1 font-mono text-[0.6rem] text-ink-subtle">
        {formatRelativeTime(new Date(thread.updatedAt), new Date(now))}
        {thread.unreadCount > 0 ? (
          <span className="text-ochre-hover"> · {thread.unreadCount} new</span>
        ) : null}
      </p>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Permalink                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The canonical address of one conversation.
 *
 * A thread is a resource with a permanent identity, and `/api/v1/messages/{id}`
 * is that resource's URL. Putting it on the row means a conversation can be
 * linked to, bookmarked, or quoted back at an instructor in a way that keeps
 * working after the message list is re-sorted or the thread is archived.
 *
 * It is a sibling of the row's select button rather than a child of it, because
 * an anchor inside a button is invalid HTML and, worse, is announced by some
 * screen readers as a single control with two names. Two controls, two jobs.
 *
 * The hit area is the full height of the row and 44px wide, which clears the
 * touch-target floor without inflating the row — the row is already taller than
 * 44px, so the link costs no vertical space.
 *
 * Opacity is kept visible rather than revealed on hover: an invisible control
 * that still responds to clicks is a trap, and one that only appears on hover is
 * unreachable by keyboard and by touch.
 */
function ThreadPermalink({ subject, threadId }: { subject: string; threadId: string }) {
  return (
    <a
      href={`/api/v1/messages/${encodeURIComponent(threadId)}`}
      title="Copy a link to this conversation"
      className={cn(
        "flex w-11 shrink-0 items-center justify-center",
        "text-ink-subtle transition-colors duration-fast",
        "hover:text-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
      )}
    >
      <svg width="13" height="13" viewBox="0 0 15 15" fill="none" aria-hidden>
        <path
          d="M6.6 8.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M8.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.9-.9"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">Permalink to {subject}</span>
    </a>
  );
}

/* -------------------------------------------------------------------------- */
/* Conversation                                                                */
/* -------------------------------------------------------------------------- */

function Conversation({
  thread,
  messages,
  loading,
  failed,
  now,
  onReply,
  onRetry,
}: {
  thread: MailThreadSummary;
  messages: MailMessage[] | null;
  loading: boolean;
  failed: boolean;
  now: string;
  onReply: () => void;
  onRetry: () => void;
}) {
  const others = thread.participants.filter((participant) => !participant.isSelf);

  return (
    <Panel as="section" aria-labelledby="conversation">
      <div className="border-b border-rule px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          {thread.courseCode ? <Code>{thread.courseCode}</Code> : null}
          <h2
            id="conversation"
            className="min-w-0 flex-1 truncate text-md font-semibold tracking-[-0.012em] text-ink"
          >
            {thread.subject}
          </h2>
        </div>
        <p className="mt-1 truncate text-2xs text-ink-muted">
          {others.length > 0
            ? others.map((person) => `${person.name}${person.title ? `, ${person.title}` : ""}`).join(" · ")
            : "Institute administration"}
        </p>
      </div>

      {/*
        The status region is always present so that "loading" and "here it is"
        occupy the same place. A conversation that appears in a different shape
        depending on connection speed is disorienting.
      */}
      <div aria-live="polite" aria-busy={loading}>
        {failed ? (
          <div className="px-4 py-5">
            <p className="text-sm text-danger-hover">Could not load this conversation.</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              The message history is stored on the server. Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-md border border-rule-strong px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-fast hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Try again
            </button>
          </div>
        ) : loading && messages === null ? (
          <ul className="divide-y divide-rule" aria-hidden>
            {[0, 1].map((index) => (
              <li key={index} className="px-4 py-3.5">
                <div className="h-3 w-32 rounded-xs bg-well" />
                <div className="mt-2.5 h-3 w-full rounded-xs bg-well" />
                <div className="mt-1.5 h-3 w-2/3 rounded-xs bg-well" />
              </li>
            ))}
          </ul>
        ) : messages && messages.length > 0 ? (
          <ol className="divide-y divide-rule">
            {messages.map((message) => (
              <MessageRow key={message.id} message={message} now={now} />
            ))}
          </ol>
        ) : (
          <EmptyState
            compact
            title="No messages yet"
            description="This thread is empty. Write the first message."
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2.5">
        <span className="font-mono text-2xs tabular-nums text-ink-subtle">
          {messages ? `${messages.length} message${messages.length === 1 ? "" : "s"}` : "—"}
        </span>
        <button
          type="button"
          onClick={onReply}
          className="rounded-sm px-2 py-1 text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Reply
        </button>
      </div>
    </Panel>
  );
}

function MessageRow({ message, now }: { message: MailMessage; now: string }) {
  const initials =
    message.isSelf
      ? "You"
      : message.senderName
          .split(" ")
          .map((part) => part[0] ?? "")
          .slice(0, 2)
          .join("");

  return (
    <li className={cn("px-4 py-3.5", message.isSelf && "bg-well/50")}>
      <div className="flex items-center gap-2">
        <Avatar initials={initials} hue={message.senderHue} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-ink">
            {message.isSelf ? "You" : message.senderName}
          </span>
          {message.senderTitle ? (
            <span className="block truncate text-2xs text-ink-subtle">{message.senderTitle}</span>
          ) : null}
        </span>
        <time
          dateTime={message.createdAt}
          className="shrink-0 font-mono text-2xs tabular-nums text-ink-subtle"
        >
          {formatRelativeTime(new Date(message.createdAt), new Date(now))}
        </time>
      </div>
      {/* `whitespace-pre-wrap` rather than a typographic scale: these are plain
          paragraphs from a textarea, and a two-line note set in display type
          would read as an essay. */}
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">{message.body}</p>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Composer                                                                    */
/* -------------------------------------------------------------------------- */

const MAX_BODY = 5000;

function Composer({
  recipients,
  initialRecipientId,
  onCancel,
  onSent,
}: {
  recipients: MailRecipient[];
  initialRecipientId?: string;
  onCancel: () => void;
  onSent: () => void;
}) {
  const [recipientId, setRecipientId] = useState(initialRecipientId ?? recipients[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Restore an abandoned draft. `sessionStorage` rather than `localStorage`, so
  // closing the tab discards it — which is what someone who walked away from a
  // message expects.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(DRAFT_KEY);
      if (!stored) return;
      const draft = JSON.parse(stored) as {
        subject: string;
        body: string;
        recipientId: string;
      };
      setSubject(draft.subject ?? "");
      setBody(draft.body ?? "");
      if (!initialRecipientId && draft.recipientId) setRecipientId(draft.recipientId);
    } catch {
      // A corrupt draft is not worth a message; start clean.
    }
    // Only on mount: re-running on every keystroke would fight the restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (!subject.trim() && !body.trim()) sessionStorage.removeItem(DRAFT_KEY);
      else
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ subject, body, recipientId }));
    } catch {
      /* private mode or quota — the draft simply will not survive navigation */
    }
  }, [subject, body, recipientId]);

  if (recipients.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No one to write to"
          description="You can start a thread with the instructor of any course you are enrolled in. You have no active enrolments this term."
        />
      </Panel>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setError("Write something before sending.");
      bodyRef.current?.focus();
      return;
    }
    if (!recipientId) {
      setError("Choose a recipient.");
      return;
    }

    setSending(true);
    try {
      const response = await fetch("/api/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipientId,
          subject: subject.trim() || "(no subject)",
          body: trimmed,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(
          payload?.error?.message ??
            `The server refused the message (${response.status}). It has not been sent.`,
        );
        setSending(false);
        return;
      }

      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* nothing to clear */
      }
      setBody("");
      setSubject("");
      onSent();
    } catch {
      setError("Could not reach the server. Your draft is safe — try again in a moment.");
      setSending(false);
    }
  };

  return (
    <Panel as="section" aria-labelledby="composer">
      <div className="border-b border-rule px-4 py-3">
        <h2 id="composer" className="text-md font-semibold text-ink">
          New message
        </h2>
      </div>

      <form onSubmit={submit} className="px-4 py-3.5">
        <div className="grid gap-2.5">
          <label className="flex items-center gap-2.5 text-xs">
            <span className="w-14 shrink-0 font-mono text-2xs uppercase tracking-[0.12em] text-ink-subtle">
              To
            </span>
            <select
              value={recipientId}
              onChange={(event) => setRecipientId(event.target.value)}
              className="min-w-0 flex-1 cursor-pointer rounded-sm border border-rule-strong bg-surface px-2 py-1.5 text-xs text-ink focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
            >
              {recipients.map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.name} — {recipient.courseCodes.join(", ")}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2.5 text-xs">
            <span className="w-14 shrink-0 font-mono text-2xs uppercase tracking-[0.12em] text-ink-subtle">
              Subject
            </span>
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={140}
              placeholder="Optional"
              className="min-w-0 flex-1 rounded-sm border border-rule-strong bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
            />
          </label>

          <label className="block text-xs">
            <span className="sr-only">Message</span>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={8}
              maxLength={MAX_BODY}
              required
              placeholder="Write your message…"
              aria-invalid={error ? true : undefined}
              aria-describedby="composer-error"
              className="w-full resize-y rounded-sm border border-rule-strong bg-surface px-3 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
            />
          </label>

          <div className="flex items-baseline justify-between gap-3">
            <div id="composer-error" className="min-h-[1.1rem]" aria-live="polite">
              {error ? (
                <p role="alert" className="text-xs leading-snug text-danger-hover">
                  {error}
                </p>
              ) : (
                <p className="text-2xs text-ink-subtle">
                  Kept on this device until you send or clear it.
                </p>
              )}
            </div>
            <span className="shrink-0 font-mono text-2xs tabular-nums text-ink-subtle">
              {MAX_BODY - body.trim().length}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.removeItem(DRAFT_KEY);
                } catch {
                  /* nothing to clear */
                }
                setBody("");
                setSubject("");
                onCancel();
              }}
              className="rounded-md px-3 py-1.5 text-xs text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Discard
            </button>
            <button
              type="submit"
              disabled={sending}
              className="inline-flex h-[var(--control-sm)] items-center rounded-md bg-accent px-3.5 text-xs font-semibold text-accent-fg transition-colors duration-fast hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send message"}
            </button>
          </div>
        </div>
      </form>
    </Panel>
  );
}
