-- The weekly chase for an answer on a submitted variation.
--
-- Its own kind rather than reusing `notice_issued`: a notice is evidence and a
-- chase is not, and "how often are we chasing this client" is a question worth
-- being able to ask without the notices mixed in.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'client_followup';
