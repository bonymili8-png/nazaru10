-- Breeding: stud services, covering events with gestation, foal delivery.

ALTER TABLE horses DROP CONSTRAINT horses_status_check;
ALTER TABLE horses ADD CONSTRAINT horses_status_check
  CHECK (status IN ('IDLE','TRAINING','ENTERED','RACING','INJURED','LISTED','BREEDING','RETIRED'));

-- A stallion standing at stud for other owners' mares.
CREATE TABLE studs (
  horse_id    uuid PRIMARY KEY REFERENCES horses(id),
  owner_id    uuid NOT NULL REFERENCES users(id),
  fee         bigint NOT NULL CHECK (fee >= 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studs_active ON studs (fee) WHERE active;

CREATE TABLE breeding_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sire_id        uuid NOT NULL REFERENCES horses(id),
  dam_id         uuid NOT NULL REFERENCES horses(id),
  owner_id       uuid NOT NULL REFERENCES users(id),   -- mare owner = foal owner & breeder
  sire_owner_id  uuid NOT NULL REFERENCES users(id),
  stud_fee       bigint NOT NULL DEFAULT 0 CHECK (stud_fee >= 0),
  breeding_fee   bigint NOT NULL CHECK (breeding_fee >= 0),
  inbreeding     numeric(6,4) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DELIVERED')),
  covered_at     timestamptz NOT NULL,
  due_at         timestamptz NOT NULL,
  delivered_at   timestamptz,
  foal_id        uuid REFERENCES horses(id),
  mutation       jsonb,
  CHECK (sire_id <> dam_id),
  CHECK (due_at > covered_at),
  CHECK ((status = 'DELIVERED') = (foal_id IS NOT NULL))
);
-- A mare carries at most one foal at a time.
CREATE UNIQUE INDEX breeding_one_pending_per_dam ON breeding_events (dam_id) WHERE status = 'PENDING';
CREATE INDEX breeding_due ON breeding_events (due_at) WHERE status = 'PENDING';
CREATE INDEX breeding_sire_recent ON breeding_events (sire_id, covered_at DESC);
CREATE INDEX breeding_owner ON breeding_events (owner_id, covered_at DESC);
CREATE INDEX horses_parents ON horses (sire_id, dam_id);
