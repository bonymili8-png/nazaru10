DROP INDEX users_nudge_due;
ALTER TABLE users DROP COLUMN nudges, DROP COLUMN last_nudge_at;
