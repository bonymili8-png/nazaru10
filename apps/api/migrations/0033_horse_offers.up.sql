-- Offers on horses that are not for sale: the amount is held in the market escrow until the owner
-- accepts or declines, the buyer withdraws, or the offer expires.
CREATE TABLE horse_offers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horse_id   uuid NOT NULL REFERENCES horses(id),
  buyer_id   uuid NOT NULL REFERENCES users(id),
  seller_id  uuid NOT NULL REFERENCES users(id),
  amount     bigint NOT NULL CHECK (amount > 0),
  status     text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACCEPTED','DECLINED','WITHDRAWN','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  closed_at  timestamptz,
  CHECK (buyer_id <> seller_id)
);
CREATE UNIQUE INDEX horse_offers_one_open ON horse_offers (horse_id, buyer_id) WHERE status = 'OPEN';
CREATE INDEX horse_offers_seller ON horse_offers (seller_id, created_at DESC);
CREATE INDEX horse_offers_buyer ON horse_offers (buyer_id, created_at DESC);
CREATE INDEX horse_offers_due ON horse_offers (expires_at) WHERE status = 'OPEN';
