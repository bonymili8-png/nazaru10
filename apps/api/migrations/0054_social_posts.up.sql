-- The game's own accounts on other networks (YouTube, Facebook, Instagram, Threads), connected
-- once by an admin. Tokens are encrypted with a key derived from the server's secret.
CREATE TABLE social_accounts (
  platform      text PRIMARY KEY CHECK (platform IN ('YOUTUBE','FACEBOOK','INSTAGRAM','THREADS')),
  account_id    text        NOT NULL,
  name          text        NOT NULL,
  secret        bytea       NOT NULL,
  expires_at    timestamptz,
  connected_by  uuid REFERENCES users(id),
  connected_at  timestamptz NOT NULL,
  refreshed_at  timestamptz
);

-- One row per post of a content item on a network.
CREATE TABLE social_posts (
  item_id       bigint      NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  platform      text        NOT NULL CHECK (platform IN ('YOUTUBE','FACEBOOK','INSTAGRAM','THREADS','BLUESKY')),
  status        text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED','FAILED')),
  attempts      smallint    NOT NULL DEFAULT 0,
  last_error    text,
  external_id   text,
  url           text,
  created_at    timestamptz NOT NULL,
  published_at  timestamptz,
  PRIMARY KEY (item_id, platform)
);
CREATE INDEX social_posts_published ON social_posts (platform, published_at) WHERE status = 'PUBLISHED';

-- Rendered media for posts (race video, JPEG card), served publicly for the networks to fetch
-- (Instagram, Facebook and Threads take a URL). Pruned after a week.
CREATE TABLE content_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     bigint      NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('VIDEO','IMAGE')),
  mime        text        NOT NULL,
  bytes       bytea       NOT NULL,
  created_at  timestamptz NOT NULL,
  UNIQUE (item_id, kind)
);
