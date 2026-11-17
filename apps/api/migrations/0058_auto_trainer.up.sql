-- The auto-trainer: paid by the month in gems, it trains every free horse of the stable twice a
-- day in the owner's local time (settings.timezone), paying the usual credits per session.
CREATE TABLE auto_trainers (
  user_id            uuid PRIMARY KEY REFERENCES users(id),
  paid_until         timestamptz NOT NULL,
  paused             boolean     NOT NULL DEFAULT false,
  -- The local day the wallet last hit the credit floor (one message a day).
  low_credits_on     date,
  expiry_notified    boolean     NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL
);

-- One row per session it started: at most one morning and one afternoon run per horse and local day.
CREATE TABLE auto_training_runs (
  horse_id    uuid        NOT NULL REFERENCES horses(id),
  local_date  date        NOT NULL,
  slot        text        NOT NULL CHECK (slot IN ('MORNING','AFTERNOON')),
  user_id     uuid        NOT NULL REFERENCES users(id),
  session_id  uuid        NOT NULL REFERENCES training_sessions(id),
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (horse_id, local_date, slot)
);
CREATE INDEX auto_training_runs_user ON auto_training_runs (user_id, created_at DESC);
