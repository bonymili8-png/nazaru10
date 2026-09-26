-- Syndicates: partners own shares of a horse (the owner/manager holds the remainder).
CREATE TABLE horse_shares (
  horse_id     uuid NOT NULL REFERENCES horses(id),
  holder_id    uuid NOT NULL REFERENCES users(id),
  shares       smallint NOT NULL CHECK (shares > 0),
  cost_paid    bigint NOT NULL DEFAULT 0 CHECK (cost_paid >= 0),
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (horse_id, holder_id)
);
CREATE INDEX horse_shares_holder ON horse_shares (holder_id);

-- Shares the manager currently offers (one offer per horse).
CREATE TABLE share_offers (
  horse_id         uuid PRIMARY KEY REFERENCES horses(id),
  manager_id       uuid NOT NULL REFERENCES users(id),
  price_per_share  integer NOT NULL CHECK (price_per_share > 0),
  available        smallint NOT NULL CHECK (available > 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
