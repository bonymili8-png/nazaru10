-- Expert trainer's advice bought per horse (for as long as the buyer owns it).
CREATE TABLE advice_unlocks (
  user_id     uuid NOT NULL REFERENCES users(id),
  horse_id    uuid NOT NULL REFERENCES horses(id),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, horse_id)
);
