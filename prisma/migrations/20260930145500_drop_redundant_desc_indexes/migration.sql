-- Drop the duplicate DESC indexes created in the previous migration.
--
-- Postgres serves `ORDER BY col DESC` from an ascending index with a backward
-- scan at the same cost, so both queries are already covered by the ascending
-- indexes Prisma manages:
--
--   WHERE "actorId" = $1 ORDER BY "createdAt" DESC  ->  (actorId, createdAt)
--   WHERE ... ORDER BY "updatedAt" DESC              ->  (updatedAt)
--
-- The DESC variants cost an extra index write on every insert and update to the
-- append-only audit table and to every thread touch, for no query-plan benefit.
-- Keeping only the versions the schema can express also means `prisma migrate
-- dev` sees no drift, so these can never be silently re-added or dropped again.

DROP INDEX IF EXISTS "audit_events_actor_recent_idx";
DROP INDEX IF EXISTS "threads_recent_idx";
