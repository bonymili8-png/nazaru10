-- One row per player per UTC day they opened the game: DAU/WAU/MAU and D1/D7 retention.
CREATE TABLE user_activity (
  user_id uuid NOT NULL REFERENCES users(id),
  day     date NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX user_activity_day ON user_activity (day);
-- Backfill what we know: the signup day and the last visit.
INSERT INTO user_activity (user_id, day)
  SELECT id, (created_at AT TIME ZONE 'UTC')::date FROM users
  UNION
  SELECT id, (last_seen_at AT TIME ZONE 'UTC')::date FROM users WHERE last_seen_at IS NOT NULL
ON CONFLICT DO NOTHING;
