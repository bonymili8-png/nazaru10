-- Yard events: small things that go wrong between starts, each a choice. See engine yard/index.ts.
CREATE TABLE yard_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  horse_id    uuid        NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  kind        text        NOT NULL,
  -- One event per owner per window: lazy creation is idempotent.
  window_no   integer     NOT NULL,
  happened_at timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  choice      text CHECK (choice IN ('ACT', 'WAIT')),
  -- The owner answered (false: it settled on its own after expiring).
  answered    boolean     NOT NULL DEFAULT false,
  resolved_at timestamptz,
  outcome     jsonb,
  UNIQUE (user_id, window_no)
);
CREATE INDEX yard_events_open ON yard_events (user_id, happened_at DESC);

-- A one-off injury-risk multiplier for the next start (heat in a leg left untreated).
ALTER TABLE horses ADD COLUMN next_start_injury real NOT NULL DEFAULT 1 CHECK (next_start_injury > 0);
