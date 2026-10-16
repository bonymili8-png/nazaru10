DROP INDEX IF EXISTS tournaments_finished;
ALTER TABLE tournaments DROP COLUMN IF EXISTS cancel_reason;
