-- Showdowns: exhibition tournaments for real people on tournament horses (engine showdown/).
-- Outside the game economy: no fees, prizes, ratings, and no effect on anyone's stable.
CREATE TABLE showdowns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  mode        text        NOT NULL CHECK (mode IN ('NORMAL', 'NO_FATIGUE')),
  -- Pace horses fill each race up to the configured field size.
  fill_field  boolean     NOT NULL DEFAULT true,
  host_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FINISHED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX showdowns_host ON showdowns (host_id, status);

CREATE TABLE showdown_players (
  showdown_id  uuid        NOT NULL REFERENCES showdowns(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- A handle for the broadcast (e.g. the blogger's name), Latin only like other names.
  display_name text        NOT NULL,
  -- The tournament horse (engine ShowdownHorse), fixed for the whole showdown.
  horse        jsonb       NOT NULL,
  fatigue      real        NOT NULL DEFAULT 0,
  fatigue_at   timestamptz NOT NULL DEFAULT now(),
  points       integer     NOT NULL DEFAULT 0,
  wins         integer     NOT NULL DEFAULT 0,
  races        integer     NOT NULL DEFAULT 0,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (showdown_id, user_id)
);
CREATE INDEX showdown_players_user ON showdown_players (user_id);

CREATE TABLE showdown_races (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showdown_id  uuid        NOT NULL REFERENCES showdowns(id) ON DELETE CASCADE,
  no           integer     NOT NULL,
  track_code   text        NOT NULL,
  distance     integer     NOT NULL,
  weather      text        NOT NULL,
  wetness      smallint    NOT NULL,
  going        text        NOT NULL,
  -- Tactics by user id; a player listed in `resting` sits this race out.
  tactics      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resting      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status       text        NOT NULL DEFAULT 'CALLED' CHECK (status IN ('CALLED', 'RUN', 'SETTLED', 'CANCELLED')),
  starts_at    timestamptz NOT NULL,
  results_at   timestamptz,
  field        jsonb,
  results      jsonb,
  frames       jsonb,
  events       jsonb,
  commentary   jsonb,
  winning_time real,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (showdown_id, no)
);
CREATE INDEX showdown_races_due ON showdown_races (starts_at) WHERE status IN ('CALLED', 'RUN');
