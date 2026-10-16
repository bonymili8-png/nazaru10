-- Credits bought with gems: one row per exchange (the ledger posting holds the money).
CREATE TABLE gem_exchanges (
  id          bigserial PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id  text        NOT NULL,
  gems        integer     NOT NULL CHECK (gems > 0),
  credits     integer     NOT NULL CHECK (credits > 0),
  tx_id       bigint      NOT NULL REFERENCES ledger_transactions(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
-- Today's cap per owner, and the admin's totals by period.
CREATE INDEX gem_exchanges_user_day ON gem_exchanges (user_id, created_at);
CREATE INDEX gem_exchanges_created ON gem_exchanges (created_at);
