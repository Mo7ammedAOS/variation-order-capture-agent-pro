-- A notice is the first message this system sends to somebody OUTSIDE the
-- company, and the first whose delivery result is evidence rather than
-- convenience. It needs its own kind so it can never be swept up by the daily
-- chase, counted as a staff reminder, or shown in a user's notification bell.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it,
-- so this is its own migration and nothing here references the new value.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'notice_issued';
