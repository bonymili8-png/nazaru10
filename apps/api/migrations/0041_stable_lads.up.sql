-- Stable lads hired for gems: they do the yard round (free care jobs) for the owner.
CREATE TABLE stable_lads (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lads            integer     NOT NULL CHECK (lads BETWEEN 1 AND 5),
  paid_until      timestamptz NOT NULL,
  -- When the lads last went round, and the last round that found work (for the owner to see).
  last_round_at   timestamptz,
  last_work_at    timestamptz,
  last_work_jobs  integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stable_lads_due ON stable_lads (last_round_at NULLS FIRST, paid_until);
