-- Scouting reports: a player bought the genetic potential of another owner's horse (gems).
CREATE TABLE scout_reports (
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  horse_id   uuid        NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, horse_id)
);
-- Owner search by name, username or stable name.
CREATE INDEX IF NOT EXISTS stables_name_lower ON stables (lower(name));
