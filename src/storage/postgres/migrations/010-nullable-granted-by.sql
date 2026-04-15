-- 010-nullable-granted-by.sql
-- Make granted_by nullable for provisioner-originated tournament assignments.
-- Provisioner grants don't originate from a users table record.

ALTER TABLE tournament_assignments ALTER COLUMN granted_by DROP NOT NULL;
