-- DropIndex
DROP INDEX "attendance_records_studentId_idx";

-- DropIndex
DROP INDEX "attendance_records_student_recent_idx";

-- DropIndex
DROP INDEX "audit_events_actor_recent_idx";

-- DropIndex
DROP INDEX "threads_recent_idx";

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "studyYear" INTEGER;

-- CreateIndex
CREATE INDEX "announcements_audience_studyYear_idx" ON "announcements"("audience", "studyYear");

-- CreateIndex
CREATE INDEX "attendance_records_student_recent_idx" ON "attendance_records"("studentId", "markedAt");

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
