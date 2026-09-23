CREATE TABLE horses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  sex                   text NOT NULL CHECK (sex IN ('COLT','FILLY','STALLION','MARE','GELDING')),
  birth_at              timestamptz NOT NULL,
  owner_id              uuid REFERENCES users(id),
  stable_id             uuid REFERENCES stables(id),
  is_house              boolean NOT NULL DEFAULT false,
  house_class           text,
  sale_price            bigint CHECK (sale_price IS NULL OR sale_price > 0),
  breeder_id            uuid REFERENCES users(id),
  sire_id               uuid REFERENCES horses(id),
  dam_id                uuid REFERENCES horses(id),
  generation            smallint NOT NULL DEFAULT 0,
  genome                jsonb NOT NULL,
  attributes            jsonb NOT NULL,
  rarity                text NOT NULL CHECK (rarity IN ('COMMON','UNCOMMON','RARE','EPIC','LEGENDARY')),
  bloodline             text NOT NULL,
  coat                  text NOT NULL,
  status                text NOT NULL DEFAULT 'IDLE'
                          CHECK (status IN ('IDLE','TRAINING','ENTERED','RACING','INJURED','LISTED','RETIRED')),
  fatigue               numeric(6,2) NOT NULL DEFAULT 0 CHECK (fatigue BETWEEN 0 AND 100),
  health                numeric(6,2) NOT NULL DEFAULT 100 CHECK (health BETWEEN 0 AND 100),
  form                  numeric(5,3) NOT NULL DEFAULT 0 CHECK (form BETWEEN -1 AND 1),
  condition_updated_at  timestamptz NOT NULL DEFAULT now(),
  injured_until         timestamptz,
  ability_rating        numeric(5,1) NOT NULL,
  race_rating           integer NOT NULL DEFAULT 1000,
  starts                integer NOT NULL DEFAULT 0 CHECK (starts >= 0),
  wins                  integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  seconds               integer NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  thirds                integer NOT NULL DEFAULT 0 CHECK (thirds >= 0),
  earnings              bigint NOT NULL DEFAULT 0 CHECK (earnings >= 0),
  diagnosed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  retired_at            timestamptz,
  CHECK (is_house OR owner_id IS NOT NULL),
  CHECK (NOT is_house OR owner_id IS NULL),
  CHECK (sire_id IS NULL OR sire_id <> id),
  CHECK (dam_id IS NULL OR dam_id <> id),
  CHECK (wins + seconds + thirds <= starts)
);
CREATE INDEX horses_owner ON horses (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX horses_house ON horses (house_class, status) WHERE is_house;
CREATE INDEX horses_for_sale ON horses (sale_price) WHERE sale_price IS NOT NULL;
CREATE INDEX horses_rating ON horses (race_rating DESC) WHERE NOT is_house;
CREATE INDEX horses_earnings ON horses (earnings DESC) WHERE NOT is_house;

-- The genome is immutable once a horse exists.
CREATE FUNCTION horses_genome_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.genome IS DISTINCT FROM OLD.genome THEN
    RAISE EXCEPTION 'horse genome is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER horses_genome_guard BEFORE UPDATE ON horses FOR EACH ROW EXECUTE FUNCTION horses_genome_immutable();

CREATE TABLE horse_ownership_history (
  id             bigserial PRIMARY KEY,
  horse_id       uuid NOT NULL REFERENCES horses(id),
  from_owner_id  uuid REFERENCES users(id),
  to_owner_id    uuid REFERENCES users(id),
  reason         text NOT NULL,
  price          bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX horse_ownership_history_horse ON horse_ownership_history (horse_id, id);
CREATE TRIGGER horse_ownership_history_immutable BEFORE UPDATE OR DELETE ON horse_ownership_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE training_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horse_id      uuid NOT NULL REFERENCES horses(id),
  owner_id      uuid NOT NULL REFERENCES users(id),
  type          text NOT NULL,
  intensity     text NOT NULL CHECK (intensity IN ('LIGHT','NORMAL','HARD')),
  cost          integer NOT NULL CHECK (cost >= 0),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
  start_state   jsonb NOT NULL,
  started_at    timestamptz NOT NULL,
  completes_at  timestamptz NOT NULL,
  completed_at  timestamptz,
  result        jsonb,
  CHECK (completes_at > started_at)
);
CREATE UNIQUE INDEX training_one_active_per_horse ON training_sessions (horse_id) WHERE status = 'ACTIVE';
CREATE INDEX training_due ON training_sessions (completes_at) WHERE status = 'ACTIVE';
CREATE INDEX training_horse_recent ON training_sessions (horse_id, started_at DESC);

CREATE TABLE injuries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horse_id    uuid NOT NULL REFERENCES horses(id),
  source      text NOT NULL CHECK (source IN ('TRAINING','RACE')),
  source_id   text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('MINOR','MODERATE')),
  heals_at    timestamptz NOT NULL,
  factors     jsonb NOT NULL DEFAULT '{}'::jsonb,
  treated_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id, horse_id)
);
CREATE INDEX injuries_horse ON injuries (horse_id, created_at DESC);
