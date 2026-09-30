/**
 * User-agent labelling.
 *
 * The sessions screen has to answer "where am I signed in?" and the honest way to
 * do that is to parse the agent string rather than to show it. A list of
 * truncated `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36…` rows
 * is unreadable and, worse, makes every entry look alike, which defeats the one
 * purpose of the screen: spotting the entry that is not yours.
 *
 * The parser is deliberately conservative. It recognises the tokens that
 * distinguish devices and browsers, and when it does not recognise enough it
 * returns `null` so the caller can say "Unrecognised device" instead of
 * inventing a plausible-sounding device. A wrong label is worse than no label,
 * because a student scanning for an intruder cannot tell which entries are
 * confident and which are guesses.
 *
 * This is a presentation concern only. Nothing here makes a security decision —
 * authorising a session is the token hash in `lib/auth/session.ts`, and a
 * mislabelled row cannot grant access to anything.
 */

interface AgentFacts {
  browser: string | null;
  platform: string | null;
  mobile: boolean;
}

/**
 * Order matters.
 *
 * Most user agents lie: Chrome, Edge, Opera and Samsung Internet all claim to be
 * Chrome, and Chrome claims to be Safari. The fix is to test the most specific
 * impersonators first, so a rule for Edge cannot consume the token Chrome needs.
 */
function read(agent: string): AgentFacts {
  const has = (needle: string) => agent.includes(needle);

  let browser: string | null = null;
  if (has("Edg/") || has("Edge/")) browser = "Edge";
  else if (has("OPR/") || has("Opera")) browser = "Opera";
  else if (has("SamsungBrowser")) browser = "Samsung Internet";
  else if (has("YaBrowser")) browser = "Yandex";
  else if (has("Firefox/")) browser = "Firefox";
  else if (has("Chrome/") || has("CriOS")) browser = "Chrome";
  else if (has("Safari/") && has("Version/")) browser = "Safari";
  else if (has("curl/")) browser = "curl";
  else if (has("node") || has("undici") || has("axios")) browser = "a script";

  let platform: string | null = null;
  if (has("Windows")) platform = "Windows";
  else if (has("iPhone") || has("iPad")) platform = "iOS";
  else if (has("Android")) platform = "Android";
  else if (has("Mac OS X") || has("Macintosh")) platform = "macOS";
  else if (has("CrOS")) platform = "ChromeOS";
  else if (has("Ubuntu") || has("Fedora") || has("Debian")) platform = "Linux";
  else if (has("Linux") || has("X11")) platform = "Linux";

  return {
    browser,
    platform,
    mobile: has("Mobile") || has("iPhone") || has("iPad") || has("Android"),
  };
}

/**
 * A short human label, or `null` when the agent is too opaque to name.
 *
 * The two-fact minimum is the threshold. "Chrome" alone could be any of four
 * platforms, and on a list of three sessions that is not enough to tell them
 * apart — so a browser with no platform is refused rather than shown.
 */
export function describeAgent(agent: string | null | undefined): string | null {
  if (!agent || agent.trim() === "") return null;

  const facts = read(agent);
  if (!facts.browser || !facts.platform) return null;

  const device = facts.platform === "macOS" && facts.mobile ? "iPad" : facts.platform;
  return `${facts.browser} on ${device}`;
}

/**
 * A slightly longer form for the "unknown" case, so the row still carries
 * something the student can act on.
 */
export function describeAgentOrUnknown(agent: string | null | undefined): string {
  return describeAgent(agent) ?? "Unrecognised device";
}
