-- Post-race reports unlocked with gems (information about a finished race, never a prediction).
CREATE TABLE race_reports (
  user_id     uuid NOT NULL REFERENCES users(id),
  race_id     uuid NOT NULL REFERENCES races(id),
  horse_id    uuid NOT NULL REFERENCES horses(id),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, race_id, horse_id)
);
