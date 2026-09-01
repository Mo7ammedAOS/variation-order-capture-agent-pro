-- The capture exchange becomes a conversation rather than a single question.
--
-- Three new shapes of question:
--   attach   — files arrived with no words. New change, or one of these?
--   describe — they said "new", so ask for the one line we still need.
--   detail   — asked AFTER filing, to fix the facts that set the deadline.
ALTER TYPE "CaptureQuestionKind" ADD VALUE IF NOT EXISTS 'attach';
ALTER TYPE "CaptureQuestionKind" ADD VALUE IF NOT EXISTS 'describe';
ALTER TYPE "CaptureQuestionKind" ADD VALUE IF NOT EXISTS 'detail';

ALTER TABLE "capture_questions"
  ADD COLUMN IF NOT EXISTS "candidate_change_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN IF NOT EXISTS "project_id" UUID,
  ADD COLUMN IF NOT EXISTS "potential_change_id" UUID,
  ADD COLUMN IF NOT EXISTS "detail_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
