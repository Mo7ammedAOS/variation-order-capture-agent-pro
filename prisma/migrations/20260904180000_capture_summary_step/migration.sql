-- The read-back before anything is filed.
--
-- The exchange used to end by filing whatever it had understood, and the
-- reporter found out what that was from the acknowledgement. When the parse
-- was wrong he had already been told his change was on file. Showing him the
-- answers first and waiting for a word costs one message and removes the whole
-- class of "that is not what I said".
ALTER TYPE "CaptureQuestionKind" ADD VALUE IF NOT EXISTS 'summary';
