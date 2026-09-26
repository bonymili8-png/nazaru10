-- Racing Pass: seasonal XP from play, a free and a premium reward track (cosmetics and gems only).
CREATE TABLE pass_progress (
  season      integer NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id),
  xp          integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  premium_at  timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, user_id)
);

-- Each XP award is recorded once (e.g. race:<raceId>:<horseId>), so replays never double-count.
CREATE TABLE pass_xp_events (
  key         text PRIMARY KEY,
  season      integer NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id),
  xp          integer NOT NULL CHECK (xp > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pass_claims (
  season      integer NOT NULL,
  user_id     uuid NOT NULL REFERENCES users(id),
  tier        integer NOT NULL,
  track       text NOT NULL CHECK (track IN ('FREE','PREMIUM')),
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, user_id, tier, track)
);
