-- Sponsor contracts: one active per owner; one contract per sponsor per owner-week.
CREATE TABLE sponsor_contracts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  sponsor_code  text NOT NULL,
  week          integer NOT NULL,
  target        smallint NOT NULL CHECK (target > 0),
  progress      smallint NOT NULL DEFAULT 0 CHECK (progress >= 0),
  reward        integer NOT NULL CHECK (reward >= 0),
  reputation    integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','EXPIRED')),
  accepted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  completed_at  timestamptz,
  UNIQUE (user_id, week, sponsor_code)
);
CREATE UNIQUE INDEX sponsor_contracts_one_active ON sponsor_contracts (user_id) WHERE status = 'ACTIVE';
CREATE INDEX sponsor_contracts_expiring ON sponsor_contracts (expires_at) WHERE status = 'ACTIVE';
