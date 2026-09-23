CREATE TABLE jockeys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  skill       numeric(5,2) NOT NULL CHECK (skill BETWEEN 0 AND 100),
  is_house    boolean NOT NULL DEFAULT true,
  rides       integer NOT NULL DEFAULT 0,
  wins        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE races (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  class                 text NOT NULL CHECK (class IN ('MAIDEN','CLASS_5','CLASS_4','CLASS_3','CLASS_2','CLASS_1')),
  track_code            text NOT NULL,
  surface               text NOT NULL CHECK (surface IN ('TURF','DIRT','SYNTHETIC')),
  distance              integer NOT NULL CHECK (distance BETWEEN 800 AND 4000),
  weather               text NOT NULL,
  wetness               smallint NOT NULL CHECK (wetness BETWEEN 0 AND 3),
  going                 text NOT NULL,
  status                text NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN','LOCKED','RUNNING','COMPLETED','CANCELLED')),
  entry_fee             integer NOT NULL CHECK (entry_fee >= 0),
  purse                 integer NOT NULL CHECK (purse >= 0),
  min_rating            integer,
  max_rating            integer,
  maiden_only           boolean NOT NULL DEFAULT false,
  min_field             smallint NOT NULL CHECK (min_field >= 2),
  max_field             smallint NOT NULL CHECK (max_field >= min_field AND max_field <= 16),
  locks_at              timestamptz NOT NULL,
  starts_at             timestamptz NOT NULL,
  results_at            timestamptz,
  completed_at          timestamptz,
  seed_hash             text NOT NULL,
  seed                  text,
  is_special            boolean NOT NULL DEFAULT false,
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at > locks_at)
);
CREATE INDEX races_status_time ON races (status, starts_at);
CREATE INDEX races_locks ON races (locks_at) WHERE status = 'OPEN';
CREATE INDEX races_results ON races (results_at) WHERE status = 'RUNNING';
-- One scheduled (non-special) race per class, track and start time: makes scheduling idempotent.
CREATE UNIQUE INDEX races_schedule_unique ON races (class, track_code, starts_at) WHERE NOT is_special;

CREATE TABLE race_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id         uuid NOT NULL REFERENCES races(id),
  horse_id        uuid NOT NULL REFERENCES horses(id),
  owner_id        uuid REFERENCES users(id),
  is_house        boolean NOT NULL DEFAULT false,
  jockey_id       uuid REFERENCES jockeys(id),
  gate            smallint,
  strategy        text NOT NULL,
  weight_kg       numeric(4,1) NOT NULL DEFAULT 55,
  entry_fee       integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'ENTERED' CHECK (status IN ('ENTERED','WITHDRAWN','RAN','SCRATCHED')),
  snapshot        jsonb,
  position        smallint,
  finish_time     numeric(8,3),
  lengths_behind  numeric(8,2),
  prize           integer,
  rating_before   integer,
  rating_after    integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (race_id, horse_id),
  CHECK (is_house OR owner_id IS NOT NULL)
);
CREATE UNIQUE INDEX race_entries_gate ON race_entries (race_id, gate) WHERE gate IS NOT NULL;
-- A horse can only be entered in one pending race at a time.
CREATE UNIQUE INDEX race_entries_one_pending ON race_entries (horse_id) WHERE status = 'ENTERED';
CREATE INDEX race_entries_horse_history ON race_entries (horse_id, created_at DESC);
CREATE INDEX race_entries_owner ON race_entries (owner_id, created_at DESC) WHERE owner_id IS NOT NULL;

CREATE TABLE race_results (
  race_id       uuid PRIMARY KEY REFERENCES races(id),
  results       jsonb NOT NULL,
  events        jsonb NOT NULL,
  commentary    jsonb NOT NULL,
  frames        jsonb NOT NULL,
  winning_time  numeric(8,3) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
