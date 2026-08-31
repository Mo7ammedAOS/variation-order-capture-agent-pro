-- Asking the reporter which project is a notification in its own right.
--
-- Its own kind, not `task_assigned`, because it is not a task: nobody can open
-- it in the app, and it is answered by replying to the message. Filing it under
-- an existing kind would make the daily chase try to chase it.
--
-- Own migration: ALTER TYPE ... ADD VALUE cannot be used in the transaction
-- that adds it.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'capture_question';
