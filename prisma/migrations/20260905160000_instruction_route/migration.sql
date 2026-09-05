-- How the instruction reached the person who reported it.
--
-- Osman's call, 2026-09-05. It is a contractual fact and not an administrative
-- one. A verbal instruction is worth the least and needs confirming in writing
-- fastest — most contracts allow days, and that confirmation is what turns it
-- into something enforceable. A drawing revision proves itself and needs
-- nothing. An email already carries its own date stamp.
--
-- So the answer decides how urgently somebody has to write back to the
-- consultant, and it is the first thing argued over when a client later says
-- no such instruction was ever given.
--
-- Asked on WhatsApp as a numbered list, answerable by number or in the
-- reporter's own words, and inferred without asking at all when the report
-- already names a drawing — a change that quotes a revision arrived by that
-- revision, and asking would be the system pretending not to have read it.
CREATE TYPE "InstructionRoute" AS ENUM (
  'verbal',
  'site_instruction',
  'drawing',
  'email',
  'whatsapp',
  'meeting',
  'other'
);

ALTER TABLE "potential_changes" ADD COLUMN "instruction_route" "InstructionRoute";
