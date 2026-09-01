-- Understanding which project a message is about, and replying on the thread.
--
-- Three additions, all nullable or defaulted, so the migration is safe to run
-- against a live database with capture already in flight:
--
--   capture_questions.kind               choose (a list) vs confirm (one guess)
--   capture_questions.source_message_id  what the reply threads onto
--   notification_logs.reply_to_message_id  carried out to n8n lane D

CREATE TYPE "CaptureQuestionKind" AS ENUM ('choose', 'confirm');

ALTER TABLE "capture_questions"
  ADD COLUMN "kind" "CaptureQuestionKind" NOT NULL DEFAULT 'choose',
  ADD COLUMN "source_message_id" TEXT,
  ADD COLUMN "source_subject" TEXT;

ALTER TABLE "notification_logs"
  ADD COLUMN "reply_to_message_id" TEXT;
