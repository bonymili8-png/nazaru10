-- Owners' Circle: Telegram Stars subscriptions (one per user). Benefits last until period_end,
-- also after cancelling; renewals are recorded as child payments.
CREATE TABLE subscriptions (
  user_id      uuid PRIMARY KEY REFERENCES users(id),
  product_id   text NOT NULL,
  status       text NOT NULL CHECK (status IN ('ACTIVE','CANCELED','EXPIRED')),
  period_end   timestamptz NOT NULL,
  -- Latest Telegram charge: needed to cancel or resume the subscription.
  charge_id    text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  canceled_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_due ON subscriptions (period_end) WHERE status <> 'EXPIRED';

ALTER TABLE payments ADD COLUMN parent_id uuid REFERENCES payments(id);
