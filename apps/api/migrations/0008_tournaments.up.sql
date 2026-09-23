-- Tournaments: registration → heats (regular races) → final (regular race) → champion.

CREATE TABLE tournaments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  tier                     text NOT NULL CHECK (tier IN ('LOCAL','REGIONAL','NATIONAL','ELITE')),
  status                   text NOT NULL DEFAULT 'REGISTRATION'
                             CHECK (status IN ('REGISTRATION','HEATS','FINAL','COMPLETED','CANCELLED')),
  race_class               text NOT NULL,
  track_code               text NOT NULL,
  distance                 integer NOT NULL CHECK (distance BETWEEN 800 AND 4000),
  entry_fee                integer NOT NULL CHECK (entry_fee >= 0),
  purse                    integer NOT NULL CHECK (purse >= 0),
  min_season_points        integer,
  min_rating               integer,
  max_entrants             integer NOT NULL CHECK (max_entrants >= 2),
  players_per_heat         integer NOT NULL CHECK (players_per_heat >= 2),
  qualifiers_per_heat      integer NOT NULL CHECK (qualifiers_per_heat >= 1),
  opens_at                 timestamptz NOT NULL,
  registration_closes_at   timestamptz NOT NULL,
  heats_at                 timestamptz NOT NULL,
  final_at                 timestamptz NOT NULL,
  final_race_id            uuid,
  winner_horse_id          uuid REFERENCES horses(id),
  winner_owner_id          uuid REFERENCES users(id),
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at < registration_closes_at AND registration_closes_at < heats_at AND heats_at < final_at)
);
-- One scheduled tournament per tier and start time (idempotent scheduling).
CREATE UNIQUE INDEX tournaments_schedule_unique ON tournaments (tier, heats_at);
CREATE INDEX tournaments_status ON tournaments (status, heats_at);

CREATE TABLE tournament_entries (
  tournament_id   uuid NOT NULL REFERENCES tournaments(id),
  horse_id        uuid NOT NULL REFERENCES horses(id),
  owner_id        uuid NOT NULL REFERENCES users(id),
  strategy        text NOT NULL,
  status          text NOT NULL DEFAULT 'REGISTERED'
                    CHECK (status IN ('REGISTERED','WITHDRAWN','IN_HEAT','FINALIST','ELIMINATED','SCRATCHED')),
  heat_race_id    uuid,
  heat_position   smallint,
  final_position  smallint,
  entry_fee       integer NOT NULL,
  -- Incremented on re-registration after a withdrawal (keeps ledger idempotency keys unique).
  registrations   smallint NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, horse_id)
);
CREATE INDEX tournament_entries_owner ON tournament_entries (owner_id, created_at DESC);

ALTER TABLE races ADD COLUMN tournament_id uuid REFERENCES tournaments(id);
ALTER TABLE races ADD COLUMN stage text CHECK (stage IN ('HEAT','FINAL'));
ALTER TABLE races ADD CONSTRAINT races_tournament_stage CHECK ((tournament_id IS NULL) = (stage IS NULL));
CREATE INDEX races_tournament ON races (tournament_id) WHERE tournament_id IS NOT NULL;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_final_race_fk FOREIGN KEY (final_race_id) REFERENCES races(id);
ALTER TABLE tournament_entries ADD CONSTRAINT tournament_entries_heat_fk FOREIGN KEY (heat_race_id) REFERENCES races(id);
