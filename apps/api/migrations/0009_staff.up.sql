-- Staff: a shared pool of trainers; each can work for one stable at a time under a weekly contract.

CREATE TABLE trainers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  skill       smallint NOT NULL CHECK (skill BETWEEN 1 AND 100),
  specialty   text,
  salary      integer NOT NULL CHECK (salary > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staff_contracts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id   uuid NOT NULL REFERENCES trainers(id),
  owner_id     uuid NOT NULL REFERENCES users(id),
  salary       integer NOT NULL CHECK (salary > 0),
  periods      integer NOT NULL DEFAULT 1 CHECK (periods >= 1),
  started_at   timestamptz NOT NULL,
  paid_until   timestamptz NOT NULL,
  ended_at     timestamptz,
  end_reason   text CHECK (end_reason IN ('DISMISSED','UNPAID')),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
-- A trainer works for at most one stable at a time.
CREATE UNIQUE INDEX staff_contracts_one_active ON staff_contracts (trainer_id) WHERE ended_at IS NULL;
CREATE INDEX staff_contracts_owner ON staff_contracts (owner_id) WHERE ended_at IS NULL;
CREATE INDEX staff_contracts_due ON staff_contracts (paid_until) WHERE ended_at IS NULL;
