-- Automatic posts about real game events for the game's own channels.
CREATE TABLE content_items (
  id            bigserial PRIMARY KEY,
  kind          text        NOT NULL CHECK (kind IN ('RACE_OF_THE_DAY','TOURNAMENT_CHAMPION','FIRST_WIN','WEEKLY_TOP')),
  -- One item per event (the detectors re-run).
  dedupe_key    text        NOT NULL UNIQUE,
  payload       jsonb       NOT NULL,
  priority      smallint    NOT NULL DEFAULT 0,
  channel       text        NOT NULL DEFAULT 'TELEGRAM',
  status        text        NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PUBLISHED','SKIPPED','FAILED')),
  attempts      smallint    NOT NULL DEFAULT 0,
  last_error    text,
  external_id   text,
  created_at    timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  published_at  timestamptz,
  skipped_by    uuid REFERENCES users(id)
);
CREATE INDEX content_items_queue ON content_items (channel, status, priority DESC, created_at);
CREATE INDEX content_items_published ON content_items (channel, published_at) WHERE status = 'PUBLISHED';

-- Per channel: paused automatically after repeated failures until an admin resumes it.
CREATE TABLE marketing_channels (
  channel               text PRIMARY KEY,
  consecutive_failures  integer     NOT NULL DEFAULT 0,
  paused_reason         text,
  paused_at             timestamptz,
  alerted_at            timestamptz
);

-- Campaigns the system creates for its own posts have no human author.
ALTER TABLE campaigns ALTER COLUMN created_by DROP NOT NULL;
