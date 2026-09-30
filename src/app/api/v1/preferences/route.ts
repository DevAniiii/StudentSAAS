import { z } from "zod";
import { route, ok, parseJson } from "@/lib/http/responses";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/security/csrf";
import { hit, rateKey } from "@/lib/security/rate-limit";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * PATCH /api/v1/preferences
 *
 * Persists theme, density, timezone, week start and notification switches.
 *
 * Partial by design. The settings page saves from several independent places —
 * the theme control writes `{theme, density}` because the pair is read together,
 * the account panel writes `{timezone, weekStartsOn}` or `{notify}` — and a
 * whole-record PUT would mean every control has to send the entire object or it
 * silently resets the others. Every field is `.optional()`; absent means
 * unchanged, not "reset to default".
 *
 * `weekStartsOn` is validated against the real range rather than accepted as any
 * integer. The timetable sorts by `(dayOfWeek - weekStartsOn + 7) % 7`, so a
 * value of 9 or −1 does not throw — it produces a table ordered by a rotation
 * nobody asked for, which is the sort of silent wrongness that is far more
 * expensive to diagnose than a rejected request.
 *
 * `upsert` rather than `update`, because preferences are created lazily and a
 * first-ever visit has no row to update. The unique `userId` makes the race
 * between two concurrent first saves safe: the loser retries as an update rather
 * than failing with a constraint violation.
 */

const body = z
  .object({
    theme: z.enum(["LIGHT", "DARK", "SYSTEM"]).optional(),
    density: z.enum(["COMFORTABLE", "COMPACT"]).optional(),
    // 0 = Sunday … 6 = Saturday, matching `startOfWeek` in `lib/dates.ts`.
    weekStartsOn: z.number().int().min(0).max(6).optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      // Validated against the runtime's own zone database rather than a
      // hard-coded list, so a zone this build has never heard of is accepted and
      // a typo is not. An unknown zone throws in `Intl` later, at render, which
      // is exactly the failure mode worth catching here.
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat("en-GB", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, "That is not a time zone this system recognises.")
      .optional(),
    notify: z
      .object({
        assignmentDue: z.boolean(),
        gradePosted: z.boolean(),
        announcement: z.boolean(),
        messages: z.boolean(),
        paymentDue: z.boolean(),
      })
      .partial()
      .optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Send at least one preference to change.",
  );

export const PATCH = route(async (request) => {
  await assertSameOrigin(request);
  const { user } = await requireApiUser();

  const limit = hit(rateKey("prefs", user.id), env.rateLimit.writeMaxAttempts, env.rateLimit.writeWindowSeconds);
  if (!limit.allowed) {
    const { AppError } = await import("@/lib/http/errors");
    throw AppError.rateLimited(limit.retryAfterSeconds);
  }

  const parsed = await parseJson(request, body);

  const notify = parsed.notify;
  const data = {
    ...(parsed.theme ? { theme: parsed.theme } : {}),
    ...(parsed.density ? { density: parsed.density } : {}),
    ...(parsed.weekStartsOn !== undefined ? { weekStartsOn: parsed.weekStartsOn } : {}),
    ...(parsed.timezone ? { timezone: parsed.timezone } : {}),
    ...(notify?.assignmentDue !== undefined ? { notifyAssignmentDue: notify.assignmentDue } : {}),
    ...(notify?.gradePosted !== undefined ? { notifyGradePosted: notify.gradePosted } : {}),
    ...(notify?.announcement !== undefined ? { notifyAnnouncement: notify.announcement } : {}),
    ...(notify?.messages !== undefined ? { notifyMessages: notify.messages } : {}),
    ...(notify?.paymentDue !== undefined ? { notifyPaymentDue: notify.paymentDue } : {}),
  };

  const preferences = await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
    select: {
      theme: true,
      density: true,
      weekStartsOn: true,
      timezone: true,
      notifyAssignmentDue: true,
      notifyGradePosted: true,
      notifyAnnouncement: true,
      notifyMessages: true,
      notifyPaymentDue: true,
    },
  });

  return ok({ preferences });
});
