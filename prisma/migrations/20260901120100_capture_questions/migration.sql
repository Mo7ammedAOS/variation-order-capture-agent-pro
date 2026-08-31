-- "Which project did you mean?"
--
-- When a site engineer on four active jobs reports a change without naming one,
-- the system has three bad options and one good one. It can guess (a change on
-- the wrong job looks handled, so nobody ever checks it). It can park it for a
-- coordinator (who knows LESS than the reporter did). Or it can ask the person
-- who actually knows.
--
-- This table is that question, outstanding. It exists so the answer can arrive
-- minutes or hours later, through a different channel from the one the question
-- went out on, and still be matched to the right message.
CREATE TYPE "CaptureQuestionStatus" AS ENUM ('open', 'answered', 'expired', 'cancelled');

CREATE TABLE "capture_questions" (
    "id" UUID NOT NULL,
    "integration_event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    -- Short, human-typable, and unique. It is what makes a reply unambiguous
    -- when someone has two questions outstanding: "K4T9 2" can only mean one
    -- of them, where a bare "2" could mean either.
    "token" TEXT NOT NULL,

    -- Frozen at the moment of asking. Reading memberships again at answer time
    -- would mean "2" silently pointing at a different project if the person was
    -- added to a job in between.
    "candidate_project_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "asked_text" TEXT,

    "status" "CaptureQuestionStatus" NOT NULL DEFAULT 'open',
    "chosen_project_id" UUID,
    "asked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),

    -- A question nobody answers must stop being answerable. Otherwise a "3"
    -- typed next month files a change against a message everyone has forgotten.
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_questions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "capture_questions_integration_event_id_key" ON "capture_questions"("integration_event_id");
CREATE UNIQUE INDEX "capture_questions_token_key" ON "capture_questions"("token");
CREATE INDEX "capture_questions_user_id_status_idx" ON "capture_questions"("user_id", "status");

ALTER TABLE "capture_questions" ADD CONSTRAINT "capture_questions_integration_event_id_fkey"
  FOREIGN KEY ("integration_event_id") REFERENCES "integration_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capture_questions" ADD CONSTRAINT "capture_questions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defence in depth, as everywhere else: Prisma bypasses this, the service layer
-- is the real gate, and anything arriving through the anon key gets nothing.
ALTER TABLE "capture_questions" ENABLE ROW LEVEL SECURITY;
