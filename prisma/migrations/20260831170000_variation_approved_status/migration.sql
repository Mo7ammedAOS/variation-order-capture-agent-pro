-- An approved variation and "already in the contract" are opposites.
--
-- `included_scope` was doing both jobs: the final approval gate sent an AGREED
-- variation there, while the name says the work was found to be within the
-- existing contract — the outcome where the client owes nothing. A register
-- where a won claim and a lost one look identical is worse than no register.
--
-- Alone in its own migration because Postgres will not let a newly added enum
-- value be USED in the transaction that adds it.
ALTER TYPE "PotentialChangeStatus" ADD VALUE IF NOT EXISTS 'variation_approved';
