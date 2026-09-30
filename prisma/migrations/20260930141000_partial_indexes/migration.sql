-- Hand-authored indexes that the Prisma schema DSL cannot express.
-- Column names follow Prisma's default mapping (camelCase, no @map), so this
-- file must stay in sync with schema.prisma. Kept as a separate migration so
-- the generated migration stays byte-reproducible and this intent is
-- reviewable on its own.

-- Partial index for the notification badge. "How many unread?" is the only
-- query that runs on every authenticated render, and it touches a small
-- fraction of rows once a student has any history. A partial index keeps it
-- O(unread) instead of O(total) and stays tiny on disk.
CREATE INDEX "notifications_unread_idx"
  ON "notifications" ("userId", "createdAt" DESC)
  WHERE "readAt" IS NULL;

-- "What is due next, not yet submitted?" drives the Today page and the
-- Assignments board. Ordering by due date needs a covering index so the
-- query does not sort every released assessment in the term.
CREATE INDEX "assessments_due_idx"
  ON "assessments" ("dueAt" ASC)
  WHERE "dueAt" IS NOT NULL;

-- Attendance heat strip reads a whole term in reverse chronological order for
-- one student. `attendance_records` is stamped by `markedAt` (when the register
-- was closed), not `createdAt`, which this table deliberately does not have.
CREATE INDEX "attendance_records_student_recent_idx"
  ON "attendance_records" ("studentId", "markedAt" DESC);

-- Session cleanup sweeps on a schedule; an index on expiry alone avoids a
-- full scan of the session table as it grows.
CREATE INDEX "sessions_expiry_idx" ON "sessions" ("expiresAt");

-- Inbox list: threads the student participates in, most recently active.
CREATE INDEX "threads_recent_idx" ON "threads" ("updatedAt" DESC);

-- Fee balance roll-up: outstanding invoices per student, oldest due first.
-- The partial predicate keeps this off paid/void history.
CREATE INDEX "invoices_open_by_due_idx"
  ON "invoices" ("studentId", "dueOn" ASC)
  WHERE "status" IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE');

-- Idempotent payment probe. A unique constraint already guarantees
-- uniqueness; this partial index makes "has this key been seen?" a single
-- index lookup scoped to the rows that actually carry a key.
CREATE INDEX "payments_idempotency_lookup_idx"
  ON "payments" ("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- Audit trail lookups ("everything actor X did") are append-only and
-- unbounded; this keeps the paged admin view off a sequential scan.
CREATE INDEX "audit_events_actor_recent_idx"
  ON "audit_events" ("actorId", "createdAt" DESC);
