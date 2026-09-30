/**
 * Dates and the term calendar.
 *
 * Two kinds of time appear in this schema and they must never be confused:
 *
 *  - `@db.Date` columns (term bounds, class dates, invoice due dates) are
 *    *calendar dates* with no clock time and no timezone. Prisma returns them as
 *    a JS Date pinned to 00:00:00.000Z, so they are read with `getUTC*` and
 *    arithmetic is done in whole UTC days. Formatting them through the local
 *    timezone of a server in another region would shift them by a day.
 *
 *  - `@db.Timestamptz` columns (deadlines, submissions, payments) are *instants*.
 *    They are rendered in the institution's timezone, which is configuration,
 *    not server-local time.
 *
 * All timezone conversion goes through `Intl.DateTimeFormat` with an explicit
 * `timeZone`. There is no date library in the dependency tree, and none is
 * needed: the only hard problem here is the offset lookup, which ICU already
 * solves correctly including daylight-saving transitions.
 */

const DEFAULT_TIMEZONE = "UTC";

export interface CalendarDate {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

export interface TermWeek {
  /** 1-based. Clamped into 1..weekCount. */
  number: number;
  /** 0-1 across the whole term. */
  progress: number;
  /** Days elapsed since the term's first day, negative before it starts. */
  dayIndex: number;
  isBeforeTerm: boolean;
  isAfterTerm: boolean;
  /** Calendar dates covered by this week. */
  startsOn: CalendarDate;
  endsOn: CalendarDate;
  /** True when today falls inside this week. */
  isCurrent: boolean;
}

/** Read a calendar date out of an instant, in the given zone. */
export function calendarDateIn(date: Date, timeZone = DEFAULT_TIMEZONE): CalendarDate {
  // `en-CA` formats as YYYY-MM-DD, which is the cheapest reliable way to get
  // locale-independent field extraction out of Intl.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const pick = (type: "year" | "month" | "day") =>
    Number(parts.find((p) => p.type === type)?.value);

  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

/**
 * Calendar date of a `@db.Date` column. Safe to call on the value Prisma
 * returns, because it is already midnight UTC and therefore its own calendar
 * date under any real-world offset.
 */
export function asCalendarDate(value: Date): CalendarDate {
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

/** `YYYY-MM-DD`. The wire format for a calendar date. */
export function toDateKey(date: CalendarDate): string {
  return `${date.year.toString().padStart(4, "0")}-${date.month
    .toString()
    .padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}

const MS_PER_DAY = 86_400_000;

/**
 * Parse `YYYY-MM-DD` to a UTC-midnight Date — the exact representation Prisma
 * uses for a `@db.Date` column. Validates, because `new Date("2026-02-31")`
 * silently rolls into March.
 */
export function fromDateKey(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new RangeError(`Expected YYYY-MM-DD, received "${key}"`);
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number(m) < 1 || Number(m) > 12 || date.getUTCDate() !== Number(d)) {
    throw new RangeError(`"${key}" is not a real calendar date`);
  }
  return date;
}

/** Add whole days to a UTC-midnight calendar date. DST-proof by construction. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Whole days from `a` to `b`, both UTC-midnight calendar dates. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Start of the week containing `date`, honouring a configurable first day. */
export function startOfWeek(date: Date, weekStartsOn = 1): Date {
  const weekday = date.getUTCDay(); // 0 = Sunday
  const offset = (weekday - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

/**
 * Today's date in the given zone, as a UTC-midnight `Date`.
 *
 * Named for what the caller is really asking — "what is the date here?" — rather
 * than left as a bare `calendarDateIn(now, …)`, because the date and the weekday
 * returned by `mondayIndex` below have to agree, and asking for them separately
 * invites a caller to mix one zone's date with another's weekday.
 *
 * Returned as a UTC-midnight `Date` rather than a `CalendarDate` because that is
 * the form Prisma wants for a `@db.Date` column, and the form `addDays` and
 * `daysBetween` take. Returning the struct would force every caller to convert,
 * and the conversions would not all be written the same way.
 */
export function todayInZone(now: Date, timeZone = DEFAULT_TIMEZONE): Date {
  return fromDateKey(toDateKey(calendarDateIn(now, timeZone)));
}

/**
 * Weekday as a Monday-first index: Monday 0 … Sunday 6.
 *
 * Deliberately not `Date.prototype.getDay()`, which is Sunday-first. Meeting
 * patterns are stored as weekday numbers and are read in a timetable, where
 * Sunday is the *last* column; mixing the two conventions produces a schedule
 * that is off by one day in every week rather than obviously wrong once.
 */
export function mondayIndex(now: Date, timeZone = DEFAULT_TIMEZONE): number {
  const { year, month, day } = calendarDateIn(now, timeZone);
  // Re-anchor the local calendar fields at UTC midnight before reading the
  // weekday off them. At UTC midnight there is no offset to shift the day, so
  // this cannot disagree with the date it was derived from — which is the whole
  // reason it is not read from `now` directly.
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** Minutes-from-midnight → `09:30`. Meetings are stored as integers. */
export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/** 1.5 hours from 09:00 → `1h 30m`. Used for class durations. */
export function durationLabel(startMin: number, endMin: number): string {
  const minutes = endMin - startMin;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** An instant on a calendar date, expressed in the given zone. */
export function atTimeInZone(
  date: Date,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  // Two-step, because there is no single Intl call for "this wall-clock time
  // in that zone". Guess with a UTC instant, read back the wall clock, correct
  // by the difference. One iteration is enough except within a few hours of a
  // DST jump, where the second iteration lands correctly.
  const guess = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) +
      minutesFromMidnight * 60_000,
  );

  const readBack = (instant: Date) => {
    const { year, month, day } = calendarDateIn(instant, timeZone);
    const minutesNow =
      (hourIn(instant, timeZone) * 60 + minuteIn(instant, timeZone)) % 1440;
    return Date.UTC(year, month - 1, day) + minutesNow * 60_000;
  };

  const firstCorrection = readBack(guess) - guess.getTime();
  const corrected = new Date(guess.getTime() + firstCorrection);
  const secondCorrection = readBack(corrected) - corrected.getTime();
  return new Date(corrected.getTime() + secondCorrection);
}

function hourIn(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
}

function minuteIn(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, minute: "2-digit" }).format(date),
  );
}

/* -------------------------------------------------------------------------- */
/* Term maths                                                                  */
/* -------------------------------------------------------------------------- */

export interface TermBounds {
  startsOn: Date;
  endsOn: Date;
  weekCount: number;
}

/**
 * Where "now" sits inside a term.
 *
 * `dayIndex` is whole days since the term's first day, computed from calendar
 * dates rather than elapsed milliseconds, so a term boundary is never missed
 * because of an hour of clock skew.
 */
export function termPosition(
  term: TermBounds,
  today: Date,
): { week: TermWeek; daysRemaining: number } {
  const dayIndex = daysBetween(term.startsOn, today);
  const totalDays = daysBetween(term.startsOn, term.endsOn);
  const isBeforeTerm = dayIndex < 0;
  const isAfterTerm = dayIndex > totalDays;

  const rawWeek = Math.floor(dayIndex / 7);
  const number = Math.min(Math.max(rawWeek + 1, 1), term.weekCount);

  const weekStart = addDays(term.startsOn, (number - 1) * 7);
  const weekEnd = addDays(weekStart, 6);
  const clampedWeekEnd = weekEnd > term.endsOn ? term.endsOn : weekEnd;

  const week: TermWeek = {
    number,
    progress: totalDays <= 0 ? 1 : clamp(dayIndex / totalDays, 0, 1),
    dayIndex,
    isBeforeTerm,
    isAfterTerm,
    startsOn: asCalendarDate(weekStart),
    endsOn: asCalendarDate(clampedWeekEnd),
    isCurrent: !isBeforeTerm && !isAfterTerm,
  };

  return { week, daysRemaining: Math.max(0, totalDays - dayIndex) };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** True when the instant has already passed, relative to `now`. */
export function isPast(instant: Date, now: Date): boolean {
  return instant.getTime() <= now.getTime();
}

/** True when the instant falls on today's calendar date in the zone. */
export function isToday(instant: Date, now: Date, timeZone: string): boolean {
  return toDateKey(calendarDateIn(instant, timeZone)) === toDateKey(calendarDateIn(now, timeZone));
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                                */
/* -------------------------------------------------------------------------- */

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const FULL_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const TIME_ONLY = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `Sep 2026` */
export function formatMonthYear(instant: Date, timeZone = DEFAULT_TIMEZONE): string {
  return withZone(MONTH_YEAR, timeZone).format(instant);
}

/** `30 Sep` */
export function formatDayMonth(instant: Date, timeZone = DEFAULT_TIMEZONE): string {
  return withZone(DAY_MONTH, timeZone).format(instant);
}

/** `Wed, 30 Sep 2026` */
export function formatFullDate(instant: Date, timeZone = DEFAULT_TIMEZONE): string {
  return withZone(FULL_DATE, timeZone).format(instant);
}

/** `14:05` */
export function formatTime(instant: Date, timeZone = DEFAULT_TIMEZONE): string {
  return withZone(TIME_ONLY, timeZone).format(instant);
}

/** `30 Sep, 14:05` */
export function formatDateTime(instant: Date, timeZone = DEFAULT_TIMEZONE): string {
  return withZone(DATE_TIME, timeZone).format(instant);
}

/**
 * Is the relative form of this date informative, or is it a second date?
 *
 * `formatRelativeDay` collapses to an absolute date beyond two weeks, because
 * "in 47 days" stops being useful as soon as a student has to do the arithmetic
 * to know whether it is this term. That is the right call *on its own*, and the
 * wrong call when it is rendered next to the absolute date: "15 Oct · $400 ·
 * 15 Oct" is not a redundancy that reads as emphasis, it reads as a bug.
 *
 * This is the predicate a caller needs to decide whether to show the relative
 * form at all, and it lives beside the formatter that makes the decision
 * necessary — the two have to agree on the threshold or the caller cannot tell
 * which output it is going to get.
 *
 * The ±13 bound is duplicated from `formatRelativeDay` rather than exported as
 * a named constant, because it is a property of the wording ("in 13 days" is
 * the last thing worth reading) and a shared constant would suggest the two
 * could diverge safely. They cannot: the day they diverged, a caller would
 * render a redundant date with no way to know.
 */
export function nearTerm(instant: Date, now: Date, timeZone = DEFAULT_TIMEZONE): boolean {
  const delta = daysBetween(
    fromDateKey(toDateKey(calendarDateIn(now, timeZone))),
    fromDateKey(toDateKey(calendarDateIn(instant, timeZone))),
  );
  return delta >= -13 && delta <= 13;
}

/**
 * `Today`, `Tomorrow`, `Yesterday`, `in 6 days`, `3 days ago`, or a date.
 *
 * Calendar-day arithmetic in the institution's zone, so "tomorrow" means the
 * next morning for the person reading it, not 24 hours from now.
 */
export function formatRelativeDay(
  instant: Date,
  now: Date,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const target = calendarDateIn(instant, timeZone);
  const today = calendarDateIn(now, timeZone);
  const delta = daysBetween(fromDateKey(toDateKey(today)), fromDateKey(toDateKey(target)));

  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  if (delta > 1 && delta <= 13) return `in ${delta} days`;
  if (delta < -1 && delta >= -13) return `${Math.abs(delta)} days ago`;
  return withZone(DAY_MONTH, timeZone).format(instant);
}

/**
 * `just now`, `4 min ago`, `in 2 h`, `3 days ago`, or a date beyond a week.
 * Coarser than `formatRelativeDay` because it is used for feed timestamps.
 */
export function formatRelativeTime(
  instant: Date,
  now: Date,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const seconds = Math.round((now.getTime() - instant.getTime()) / 1000);
  const future = seconds < 0;
  const magnitude = Math.abs(seconds);

  if (magnitude < 45) return "just now";

  const units: [number, string][] = [
    [60, "min"],
    [3600, "h"],
    [86400, "d"],
  ];
  for (const [divisor, suffix] of units) {
    if (magnitude < divisor * (suffix === "min" ? 60 : suffix === "h" ? 24 : 7)) {
      const value = Math.max(1, Math.floor(magnitude / divisor));
      return future ? `in ${value} ${suffix}` : `${value} ${suffix} ago`;
    }
  }

  return withZone(DAY_MONTH, timeZone).format(instant);
}

/** Weekday column headers, Monday first by default. */
export function weekdayLabels(weekStartsOn = 1): string[] {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return [...names.slice(weekStartsOn), ...names.slice(0, weekStartsOn)];
}

/**
 * `resolvedOptions()` is the closest thing the platform offers to a canonical
 * options bag — by construction it is the very shape `Intl` itself accepts — but
 * TypeScript types several of its fields as plain `string` where the constructor
 * demands a literal union, so spreading it directly does not typecheck.
 *
 * The cast lives here, once, instead of at each construction site, and calling
 * it once per attempt replaces three `resolvedOptions()` calls. Nothing is being
 * asserted that is not already true: every value came back out of `Intl`.
 */
function resolvedOptionsOf(formatter: Intl.DateTimeFormat): Intl.DateTimeFormatOptions {
  return { ...formatter.resolvedOptions() } as Intl.DateTimeFormatOptions;
}

/** Memoised per-zone formatter lookup. */
function withZone(
  formatter: Intl.DateTimeFormat,
  timeZone: string,
): Intl.DateTimeFormat {
  const key = `${timeZone}|${formatter.resolvedOptions().locale}|${JSON.stringify(
    Object.keys(formatter.resolvedOptions()),
  )}`;
  let cached = dateFormatters.get(key);
  if (!cached) {
    try {
      cached = new Intl.DateTimeFormat(formatter.resolvedOptions().locale, {
        ...resolvedOptionsOf(formatter),
        timeZone,
      });
    } catch {
      // An unusable time zone must not take down a render. Falling back to UTC
      // shows a clock offset that is wrong but legible; throwing would blank the
      // page the bad value happened to appear on.
      cached = new Intl.DateTimeFormat("en-GB", {
        ...resolvedOptionsOf(formatter),
        timeZone: "UTC",
      });
    }
    dateFormatters.set(key, cached);
  }
  return cached;
}
