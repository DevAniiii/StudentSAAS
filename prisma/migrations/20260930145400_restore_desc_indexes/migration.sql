-- Recreate the two DESC-ordered indexes that the generated migration dropped.
--
-- Prisma's index DSL cannot express sort order in 6.3, so it reconciled these by
-- dropping the hand-authored DESC versions and substituting its own ascending
-- ones — which it then recognised as duplicates of the plain `@@index` entries
-- already declared on the models, so it removed those too.
--
-- Retained here (not squashed into the previous migration) so the migration
-- history stays append-only. The next migration drops them again: Postgres
-- scans an index backward at identical cost, so `WHERE actorId = $1 ORDER BY
-- createdAt DESC` is already served by the ascending `(actorId, createdAt)`
-- index the schema declares. Carrying both would cost write throughput and
-- storage for nothing.

CREATE INDEX "audit_events_actor_recent_idx"
  ON "audit_events" ("actorId", "createdAt" DESC);

CREATE INDEX "threads_recent_idx"
  ON "threads" ("updatedAt" DESC);
