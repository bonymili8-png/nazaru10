-- Cosmetics: stable racing silks and the items an owner has unlocked (gems sink, no gameplay effect).
ALTER TABLE stables ADD COLUMN silks jsonb NOT NULL
  DEFAULT '{"pattern":"SOLID","primary":"gold","secondary":"black"}'::jsonb;

CREATE TABLE owned_cosmetics (
  user_id      uuid NOT NULL REFERENCES users(id),
  item         text NOT NULL,
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item)
);
