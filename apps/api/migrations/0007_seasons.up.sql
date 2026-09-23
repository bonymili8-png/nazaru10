-- Seasons: points per (season, horse, owner-at-the-time), season closing and Hall of Fame.

CREATE TABLE season_points (
  season      integer NOT NULL CHECK (season >= 1),
  horse_id    uuid NOT NULL REFERENCES horses(id),
  owner_id    uuid NOT NULL REFERENCES users(id),
  points      integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  races       integer NOT NULL DEFAULT 0 CHECK (races >= 0),
  wins        integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, horse_id, owner_id)
);
CREATE INDEX season_points_owner ON season_points (season, owner_id);
CREATE INDEX season_points_rank ON season_points (season, points DESC);

CREATE TABLE seasons (
  season      integer PRIMARY KEY CHECK (season >= 1),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  closed_at   timestamptz,
  results     jsonb,
  CHECK (ends_at > starts_at)
);

CREATE TABLE hall_of_fame (
  id          bigserial PRIMARY KEY,
  season      integer NOT NULL REFERENCES seasons(season),
  category    text NOT NULL CHECK (category IN ('CHAMPION_OWNER','CHAMPION_HORSE','TOP_EARNER_HORSE')),
  user_id     uuid REFERENCES users(id),
  horse_id    uuid REFERENCES horses(id),
  value       bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season, category)
);
CREATE TRIGGER hall_of_fame_immutable BEFORE UPDATE OR DELETE ON hall_of_fame
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
