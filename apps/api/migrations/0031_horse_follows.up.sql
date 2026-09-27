-- Players follow horses they like (their own or others'): a list and a message when one wins.
CREATE TABLE horse_follows (
  user_id    uuid NOT NULL REFERENCES users(id),
  horse_id   uuid NOT NULL REFERENCES horses(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, horse_id)
);
CREATE INDEX horse_follows_horse ON horse_follows (horse_id);
