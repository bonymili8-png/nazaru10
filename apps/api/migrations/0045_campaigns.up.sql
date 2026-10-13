-- Campaign links: tracked links the team hands to group admins and partners, with a funnel per
-- link (clicks → opened the game → first race → still playing → bought gems).
CREATE TABLE campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{4,12}$'),
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  -- Who runs it (the group admin or author) and where (Telegram, Facebook, Instagram, …).
  partner     text,
  platform    text        NOT NULL DEFAULT 'OTHER',
  note        text,
  created_by  uuid        NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

-- A visit to the tracked link (before Telegram opens). The visitor is a keyed hash, never an IP.
CREATE TABLE campaign_clicks (
  id          bigserial PRIMARY KEY,
  campaign_id uuid        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  visitor     text        NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaign_clicks_campaign ON campaign_clicks (campaign_id, at);

-- A player who opened the game from the link; `is_new` when it brought them in (first touch).
CREATE TABLE campaign_users (
  campaign_id uuid        NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_new      boolean     NOT NULL,
  opened_at   timestamptz NOT NULL,
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX campaign_users_opened ON campaign_users (campaign_id, opened_at);
-- A player is acquired by at most one campaign.
CREATE UNIQUE INDEX campaign_users_one_acquisition ON campaign_users (user_id) WHERE is_new;
