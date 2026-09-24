-- Anti-fraud: where accounts sign in from (keyed hash, never the raw IP) and review flags.
CREATE TABLE login_ips (
  user_id     uuid NOT NULL REFERENCES users(id),
  ip_hash     text NOT NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ip_hash)
);
CREATE INDEX login_ips_hash ON login_ips (ip_hash, last_seen DESC);

CREATE TABLE fraud_flags (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  kind         text NOT NULL CHECK (kind IN ('SHARED_IP','CIRCULAR_TRADE','TRADE_FUNNEL','REFERRAL_CLUSTER','INCOME_SPIKE')),
  severity     smallint NOT NULL CHECK (severity BETWEEN 1 AND 3),
  -- One flag per user and finding (the detector is re-run periodically).
  dedupe_key   text NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DISMISSED','CONFIRMED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid REFERENCES users(id),
  reviewed_at  timestamptz,
  review_note  text,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX fraud_flags_open ON fraud_flags (status, severity DESC, created_at DESC);
