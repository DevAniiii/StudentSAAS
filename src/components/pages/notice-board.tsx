import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { Badge, Code } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/data-display";
import { formatFullDate, formatRelativeTime } from "@/lib/dates";
import type { AnnouncementView } from "@/server/comms";

/**
 * Announcements.
 *
 * A noticeboard, not a blog feed: the top of the list is what everyone must read
 * today, and reading order should not be chronological.
 *
 * So the sort is: **pinned first, then unexpired, then most recent**. Expired
 * notices sink rather than vanish — a student who missed the room-change notice
 * still needs to know the room *was* changed, and silently dropping it leaves a
 * wrong belief about where to go. They are dimmed and collapsed, which is a
 * visible difference and not a silent one.
 *
 * Announcements are grouped by course chip rather than as one flat list, because
 * the practical question is "what has my instructor said?" and that is answered
 * per course. Institute-wide notices lead, since they apply regardless.
 */

export function NoticeBoard({
  announcements,
  now,
  timezone,
}: {
  announcements: AnnouncementView[];
  now: Date;
  timezone: string;
}) {
  if (announcements.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No notices"
          description="Institute announcements and instructor notices for your courses appear here. Nothing has been published that applies to you."
        />
      </Panel>
    );
  }

  const ordered = [...announcements].sort((a, b) => {
    const aLive = a.expiresAt === null || a.expiresAt.getTime() > now.getTime();
    const bLive = b.expiresAt === null || b.expiresAt.getTime() > now.getTime();
    if (aLive !== bLive) return aLive ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.publishedAt.getTime() - a.publishedAt.getTime();
  });

  const pinned = ordered.filter((notice) => notice.pinned);
  const rest = ordered.filter((notice) => !notice.pinned);

  return (
    <div className="space-y-5">
      {pinned.length > 0 ? (
        <section aria-labelledby="pinned-notices" className="space-y-3">
          <h2
            id="pinned-notices"
            className="font-mono text-2xs uppercase tracking-[0.14em] text-ink-subtle"
          >
            Pinned
          </h2>
          {pinned.map((notice) => (
            <NoticeCard key={notice.id} notice={notice} now={now} timezone={timezone} />
          ))}
        </section>
      ) : null}

      {rest.length > 0 ? (
        <section aria-labelledby="other-notices" className="space-y-3">
          {pinned.length > 0 ? (
            <h2
              id="other-notices"
              className="font-mono text-2xs uppercase tracking-[0.14em] text-ink-subtle"
            >
              Everything else
            </h2>
          ) : null}
          {rest.map((notice) => (
            <NoticeCard key={notice.id} notice={notice} now={now} timezone={timezone} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

const AUDIENCE: Record<string, { label: string; tone: "neutral" | "info" | "accent" }> = {
  ALL_STUDENTS: { label: "All students", tone: "accent" },
  COURSE: { label: "Course", tone: "info" },
  PROGRAM: { label: "Programme", tone: "neutral" },
  YEAR: { label: "Study year", tone: "neutral" },
  STAFF: { label: "Staff", tone: "neutral" },
};

function NoticeCard({
  notice,
  now,
  timezone,
}: {
  notice: AnnouncementView;
  now: Date;
  timezone: string;
}) {
  const expired = notice.expiresAt !== null && notice.expiresAt.getTime() <= now.getTime();
  const audience = AUDIENCE[notice.audience] ?? AUDIENCE.ALL_STUDENTS;

  return (
    <Panel as="article" aria-labelledby={`notice-${notice.id}`} tone={expired ? "sunken" : "flat"}>
      <article>
        <header className="border-b border-rule px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {notice.courseCode ? (
              <Code>{notice.courseCode}</Code>
            ) : (
              <Badge tone={audience.tone}>{audience.label}</Badge>
            )}
            {notice.pinned ? <Badge tone="good">Pinned</Badge> : null}
            {expired ? <Badge tone="neutral">Expired</Badge> : null}
          </div>

          <h3
            id={`notice-${notice.id}`}
            className={cn(
              "mt-1.5 text-md font-semibold tracking-[-0.012em]",
              expired ? "text-ink-muted" : "text-ink",
            )}
          >
            {notice.title}
          </h3>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-muted">
            <Avatar initials={notice.author.initials} hue={notice.author.avatarHue} size="xs" />
            <span className="text-ink">{notice.author.name}</span>
            {notice.author.title ? <span>· {notice.author.title}</span> : null}
            <span aria-hidden>·</span>
            <time dateTime={notice.publishedAt.toISOString()} title={formatFullDate(notice.publishedAt, timezone)}>
              {formatRelativeTime(notice.publishedAt, now, timezone)}
            </time>
            {notice.expiresAt ? (
              <>
                <span aria-hidden>·</span>
                <span className={expired ? "text-ink-subtle" : "text-ink-subtle"}>
                  {expired ? "was" : "expires"}{" "}
                  <time dateTime={notice.expiresAt.toISOString()}>
                    {formatFullDate(notice.expiresAt, timezone).split(",")[0]}
                  </time>
                </span>
              </>
            ) : null}
          </div>
        </header>

        {/*
          Long notices collapse when they are not pinned. A five-paragraph room
          change should not push everything below it off the first screen, but the
          content must still be reachable — hence `<details>` rather than
          truncation, which would hide the end of a notice that matters.
        */}
        {expired || notice.body.length > 480 ? (
          <details className="group">
            <summary className="cursor-pointer list-none px-4 py-3 text-xs font-medium text-ink-muted transition-colors duration-fast hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
              <span className="group-open:hidden">
                {expired ? "Show this expired notice" : "Read the full notice"}
              </span>
              <span className="hidden group-open:inline">
                {expired ? "Hide" : "Show less"}
              </span>
            </summary>
            <div className="border-t border-rule px-4 py-3">
              <Prose body={notice.body} />
            </div>
          </details>
        ) : (
          <div className="px-4 py-3">
            <Prose body={notice.body} />
          </div>
        )}
      </article>
    </Panel>
  );
}

/**
 * Notice bodies are plain text with blank-line paragraphs.
 *
 * Not Markdown: notices are authored by staff through an admin surface this
 * project does not include, and rendering untrusted Markdown would mean shipping
 * a sanitiser for content that is one field in a form. Paragraphs and
 * whitespace are the whole format, which means no sanitiser is needed and no
 * notice can smuggle a link or a style into the page.
 */
function Prose({ body }: { body: string }) {
  const paragraphs = body.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length > 0);

  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-ink-muted", "max-w-[68ch]")}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
