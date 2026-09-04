-- Who asked for the change.
--
-- Osman's call, 2026-09-05. It is the fact that decides whether there is a
-- claim at all: the consultant asking for a different finish is a variation,
-- and the identical words from our own foreman are rework we pay for. It was
-- being captured nowhere — the reporter's sentence held it, and a sentence is
-- not something a register can be counted by.
--
-- Free text, not a contact link. The person who instructs a change on site is
-- very often not in the project's contact list: a visiting authority
-- inspector, somebody from the landlord's fit-out team, a consultant's junior
-- nobody has met. A column that can only hold a known contact records nothing
-- in precisely those cases.
ALTER TABLE "potential_changes" ADD COLUMN "instructed_by" TEXT;

-- The ceiling on a WhatsApp exchange, counted across all the facts rather than
-- per question. `ask_count` stops one question being put a third time; this
-- stops four questions asked twice each from becoming an eight message
-- interrogation nobody finishes.
ALTER TABLE "capture_questions" ADD COLUMN "detail_asks" INTEGER NOT NULL DEFAULT 0;
