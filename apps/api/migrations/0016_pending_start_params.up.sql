-- Invite codes received by the bot's /start before the player first opens the Mini App
-- (a web_app button does not pass start_param), applied when their account is created.
CREATE TABLE pending_start_params (
  telegram_id  bigint PRIMARY KEY,
  param        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
