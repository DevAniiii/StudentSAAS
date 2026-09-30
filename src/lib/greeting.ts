/**
 * A greeting, derived rather than assumed.
 *
 * Keyed to the *institution's* timezone, because that is the clock the academic
 * day runs on: a 09:00 lecture is the start of a student's day even if the
 * server is an hour behind. Greeting someone in their own timezone instead would
 * say "good evening" to a student who has a class in forty minutes.
 *
 * Only three bands, and the boundaries are conventional: before 12 is morning,
 * before 18 is afternoon, otherwise evening. More bands would mean an "early
 * morning" at 06:00 that reads like a push notification.
 *
 * Read through `Intl` rather than by hand-rolling zone maths: `hour12: false`
 * with an explicit `hourCycle` is the only way to get an unambiguous 0–23 hour
 * from every engine, and a locale that returns "24" for midnight — which
 * `hour12: false` does in some ICU versions — is handled by the modulo below.
 */
export function greeting(firstName: string, now: Date, timezone: string): string {
  let hour = 12;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).formatToParts(now);
    const raw = parts.find((part) => part.type === "hour")?.value;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(parsed)) hour = parsed % 24;
  } catch {
    // An invalid zone in a user's preferences must not take the page down.
    // Noon is a neutral default: it produces "afternoon", which is the least
    // wrong of the three.
    hour = 12;
  }

  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${part}, ${firstName}`;
}
