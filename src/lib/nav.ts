/**
 * Navigation model.
 *
 * One source of truth for the sidebar, the command palette, the mobile drawer
 * and the sitemap. Adding a route means adding an entry here; there is no
 * second list to forget to update.
 *
 * `group` drives both the visual grouping and the palette's section headings.
 * `keywords` are deliberately richer than the labels — the palette is a search
 * box, and people look for "money" or "late", not "Finance & administration".
 */

export interface NavItem {
  href: string;
  label: string;
  /** Short form for the collapsed rail and for the palette. */
  short: string;
  /** One-line description used in the command palette. */
  hint: string;
  keywords: string[];
  /** Rendered beside the label: unread messages, upcoming deadlines. */
  badge?: "unread-messages" | "unread-notifications" | "due-soon";
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "day",
    label: "Today",
    items: [
      {
        href: "/today",
        label: "Today",
        short: "Today",
        hint: "What is happening, in order of what needs doing first.",
        keywords: ["home", "now", "agenda", "overview", "dashboard"],
        badge: "due-soon",
      },
    ],
  },
  {
    id: "study",
    label: "Study",
    items: [
      {
        href: "/term",
        label: "Term",
        short: "Term",
        hint: "Courses, timetable, deadlines and disruptions for the current term.",
        keywords: ["schedule", "timetable", "courses", "classes", "calendar", "register"],
      },
      {
        href: "/assignments",
        label: "Assignments",
        short: "Work",
        hint: "Every piece of assessed work, due dates, briefs and submissions.",
        keywords: ["work", "deadlines", "homework", "submission", "brief", "due"],
        badge: "due-soon",
      },
      {
        href: "/grades",
        label: "Grades",
        short: "Grades",
        hint: "Marks, feedback, weightings and cumulative standing.",
        keywords: ["marks", "results", "score", "gpa", "transcript", "feedback", "weighting"],
      },
      {
        href: "/attendance",
        label: "Attendance",
        short: "Attend.",
        hint: "Register history and exam-eligibility projection per course.",
        keywords: ["register", "presence", "absent", "late", "eligibility", "risk"],
      },
    ],
  },
  {
    id: "admin",
    label: "Finance & admin",
    items: [
      {
        href: "/finance",
        label: "Finance",
        short: "Finance",
        hint: "Invoices, charges, payments and receipts.",
        keywords: ["money", "invoice", "bill", "payment", "receipt", "fee", "tuition", "due"],
      },
    ],
  },
  {
    id: "connect",
    label: "Communication",
    items: [
      {
        href: "/messages",
        label: "Messages",
        short: "Messages",
        hint: "Threads with instructors and the registrar.",
        keywords: ["mail", "inbox", "thread", "email", "contact", "instructor"],
        badge: "unread-messages",
      },
      {
        href: "/announcements",
        label: "Announcements",
        short: "Notices",
        hint: "Institute-wide and course notices.",
        keywords: ["news", "notice", "bulletin", "circular", "update", "posted"],
      },
    ],
  },
  {
    id: "account",
    label: "Account",
    items: [
      {
        href: "/settings",
        label: "Settings",
        short: "Settings",
        hint: "Appearance, notifications, sessions and password.",
        keywords: ["preferences", "profile", "password", "theme", "dark", "security", "sessions"],
      },
    ],
  },
];

/** Flattened view, for the palette and for `isActive` matching. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function findNavItem(href: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === href);
}

/**
 * Is this nav item the current page?
 *
 * Exact match, not a prefix match: `/assignments/[id]` should still light up
 * "Assignments", so children are resolved by their parent, but `/term` must not
 * light up for `/today`.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Keyboard shortcut labels, shown in the palette's right column. */
export const PALETTE_SHORTCUTS: Record<string, string> = {
  "/today": "G then T",
  "/term": "G then E",
  "/assignments": "G then W",
  "/grades": "G then G",
  "/attendance": "G then A",
  "/finance": "G then F",
  "/messages": "G then M",
  "/announcements": "G then N",
  "/settings": "G then S",
};
