-- Tipster league: free predictions of the first three in upcoming races (engine tipster/).
CREATE TABLE tips (
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_id    uuid        NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  -- 1st, 2nd and 3rd picks (horse ids); the 2nd and 3rd are optional.
  picks      uuid[]      NOT NULL CHECK (cardinality(picks) BETWEEN 1 AND 3),
  -- The week (Monday, UTC) of the race, for the weekly table.
  week       date        NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  scored_at  timestamptz,
  points     integer,
  slots      integer[],
  tricast    integer,
  -- The race was called off: the tip scores nothing and does not count.
  void       boolean     NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, race_id)
);
CREATE INDEX tips_unscored ON tips (race_id) WHERE scored_at IS NULL;
CREATE INDEX tips_week ON tips (week, user_id) WHERE scored_at IS NOT NULL;
CREATE INDEX tips_user_created ON tips (user_id, created_at DESC);

-- Weeks whose table is final and rewarded (idempotent close).
CREATE TABLE tipster_weeks (
  week      date        PRIMARY KEY,
  closed_at timestamptz NOT NULL,
  winners   jsonb       NOT NULL DEFAULT '[]'::jsonb
);
