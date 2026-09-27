-- Live-ops events run by the game team: a temporary Racing Pass XP boost or purse boost.
CREATE TABLE live_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('PASS_XP_BOOST','PURSE_BOOST')),
  title        text NOT NULL,
  multiplier   numeric(4,2) NOT NULL CHECK (multiplier > 1 AND multiplier <= 3),
  classes      text[],
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL CHECK (ends_at > starts_at),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
CREATE INDEX live_events_window ON live_events (kind, starts_at, ends_at) WHERE cancelled_at IS NULL;
-- Races whose purse an event boosted (so cancelling can restore open races).
ALTER TABLE races ADD COLUMN event_id uuid REFERENCES live_events(id);
-- Limited horses: a shop listing with its own end time.
ALTER TABLE horses ADD COLUMN sale_ends_at timestamptz;
