-- Identity, stables, double-entry ledger, config, outbox, audit.

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id     bigint UNIQUE,
  username        text,
  first_name      text,
  last_name       text,
  language_code   text,
  photo_url       text,
  is_premium      boolean NOT NULL DEFAULT false,
  role            text NOT NULL DEFAULT 'PLAYER' CHECK (role IN ('PLAYER','SYSTEM','SUPER_ADMIN','GAME_ADMIN',
                    'ECONOMY_ADMIN','SUPPORT_ADMIN','TOURNAMENT_ADMIN','CONTENT_ADMIN','FINANCE_ADMIN','FRAUD_ANALYST')),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  referral_code   text NOT NULL UNIQUE,
  referred_by     uuid REFERENCES users(id),
  trust_score     smallint NOT NULL DEFAULT 50 CHECK (trust_score BETWEEN 0 AND 100),
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz,
  CHECK (referred_by IS NULL OR referred_by <> id),
  CHECK (role = 'SYSTEM' OR telegram_id IS NOT NULL)
);

CREATE TABLE stables (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL UNIQUE REFERENCES users(id),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  level       smallint NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Balances. USER/ESCROW accounts can never go negative; SYSTEM accounts are per-reason
-- mint/burn counterparties whose (negative/positive) balance equals cumulative sources/sinks.
CREATE TABLE accounts (
  id          bigserial PRIMARY KEY,
  owner_type  text NOT NULL CHECK (owner_type IN ('USER','SYSTEM','ESCROW')),
  owner_id    uuid REFERENCES users(id),
  code        text,
  currency    text NOT NULL CHECK (currency IN ('CREDITS','GEMS','REPUTATION','PRESTIGE')),
  balance     bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_type = 'SYSTEM' OR balance >= 0),
  CHECK ((owner_type = 'USER') = (owner_id IS NOT NULL)),
  CHECK ((owner_type = 'USER') = (code IS NULL))
);
CREATE UNIQUE INDEX accounts_user_currency ON accounts (owner_id, currency) WHERE owner_type = 'USER';
CREATE UNIQUE INDEX accounts_code_currency ON accounts (owner_type, code, currency) WHERE owner_type <> 'USER';
CREATE INDEX accounts_leaderboard ON accounts (currency, balance DESC) WHERE owner_type = 'USER';

CREATE TABLE ledger_transactions (
  id               bigserial PRIMARY KEY,
  idempotency_key  text NOT NULL UNIQUE,
  type             text NOT NULL,
  reason           text,
  actor_id         uuid REFERENCES users(id),
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id             bigserial PRIMARY KEY,
  tx_id          bigint NOT NULL REFERENCES ledger_transactions(id),
  account_id     bigint NOT NULL REFERENCES accounts(id),
  amount         bigint NOT NULL CHECK (amount <> 0),
  balance_after  bigint NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account ON ledger_entries (account_id, id DESC);
CREATE INDEX ledger_entries_tx ON ledger_entries (tx_id);

-- Every ledger transaction must balance to zero per currency (checked at COMMIT).
CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad record;
BEGIN
  SELECT a.currency, sum(e.amount) AS total INTO bad
    FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
   WHERE e.tx_id = NEW.tx_id
   GROUP BY a.currency HAVING sum(e.amount) <> 0 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ledger transaction % unbalanced for % (%)', NEW.tx_id, bad.currency, bad.total
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- Append-only tables.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  actor_id     uuid REFERENCES users(id),
  action       text NOT NULL,
  target_type  text NOT NULL,
  target_id    text,
  before       jsonb,
  after        jsonb,
  reason       text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_target ON audit_logs (target_type, target_id);
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE game_config (
  version     serial PRIMARY KEY,
  config      jsonb NOT NULL,
  created_by  uuid REFERENCES users(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox: written in the same transaction as the change.
CREATE TABLE domain_events (
  id              bigserial PRIMARY KEY,
  type            text NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  actor_id        uuid,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);
CREATE INDEX domain_events_unprocessed ON domain_events (id) WHERE processed_at IS NULL;
CREATE INDEX domain_events_type ON domain_events (type, created_at);
