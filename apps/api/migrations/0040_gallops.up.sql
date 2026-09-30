-- Morning work on the clock against the yard's lead horse for a class. See engine gallop/index.ts.
CREATE TABLE gallops (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horse_id   uuid        NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  -- Who sent it out: a buyer does not see the seller's gallops.
  owner_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL,
  distance   integer     NOT NULL,
  surface    text        NOT NULL,
  lead_class text        NOT NULL,
  fatigue    real        NOT NULL,
  time       real        NOT NULL,
  lead_time  real        NOT NULL,
  margin     real        NOT NULL
);
CREATE INDEX gallops_horse ON gallops (horse_id, at DESC);
