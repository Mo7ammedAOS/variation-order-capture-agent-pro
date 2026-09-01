-- The three ways the money end goes quiet.
--
-- Each is a stage that has no owner by default, because the person who did the
-- last step has moved on and the person who should do the next one does not
-- know it is theirs yet:
--
--   vo_not_submitted       approved internally, never put to the client
--   approved_not_invoiced  the client agreed it and nobody applied for it
--   invoice_overdue        past its terms, unpaid, nobody chasing
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it,
-- so this is its own migration and nothing here references the new values.
ALTER TYPE "BottleneckType" ADD VALUE IF NOT EXISTS 'vo_not_submitted';
ALTER TYPE "BottleneckType" ADD VALUE IF NOT EXISTS 'approved_not_invoiced';
ALTER TYPE "BottleneckType" ADD VALUE IF NOT EXISTS 'invoice_overdue';
