-- Comeback nudges: at most one every few days, a few per absence (reset when the player returns).
ALTER TABLE users
  ADD COLUMN last_nudge_at timestamptz,
  ADD COLUMN nudges integer NOT NULL DEFAULT 0 CHECK (nudges >= 0);
CREATE INDEX users_nudge_due ON users (last_seen_at) WHERE status = 'ACTIVE' AND telegram_id IS NOT NULL;
