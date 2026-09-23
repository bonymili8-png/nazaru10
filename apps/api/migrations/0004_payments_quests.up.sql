CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  provider            text NOT NULL CHECK (provider IN ('TELEGRAM_STARS','STRIPE')),
  product_id          text NOT NULL,
  amount              integer NOT NULL CHECK (amount > 0),
  currency            text NOT NULL,
  status              text NOT NULL DEFAULT 'CREATED'
                        CHECK (status IN ('CREATED','PENDING','COMPLETED','FAILED','REFUNDED','EXPIRED')),
  invoice_link        text,
  provider_charge_id  text UNIQUE,
  provider_payload    jsonb,
  failure_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  refunded_at         timestamptz,
  CHECK (status NOT IN ('COMPLETED','REFUNDED') OR provider_charge_id IS NOT NULL)
);
CREATE INDEX payments_user ON payments (user_id, created_at DESC);

CREATE TABLE user_quests (
  user_id       uuid NOT NULL REFERENCES users(id),
  quest_code    text NOT NULL,
  completed_at  timestamptz,
  claimed_at    timestamptz,
  PRIMARY KEY (user_id, quest_code),
  CHECK (claimed_at IS NULL OR completed_at IS NOT NULL)
);
