-- Public racing news built from domain events (read model; safe to rebuild).
CREATE TABLE feed_items (
  id          bigserial PRIMARY KEY,
  event_id    bigint NOT NULL UNIQUE,
  kind        text NOT NULL,
  actor_id    uuid REFERENCES users(id),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feed_items_recent ON feed_items (id DESC);
CREATE INDEX feed_items_actor ON feed_items (actor_id, id DESC);

-- How far the feed has read the domain-event log (single row).
CREATE TABLE feed_cursor (
  id       smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_id  bigint NOT NULL DEFAULT 0
);
INSERT INTO feed_cursor (id, last_id) VALUES (1, 0);
