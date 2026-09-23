-- Player-to-player marketplace: fixed-price listings and timed auctions with escrowed bids.

CREATE TABLE market_listings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  horse_id        uuid NOT NULL REFERENCES horses(id),
  seller_id       uuid NOT NULL REFERENCES users(id),
  type            text NOT NULL CHECK (type IN ('FIXED','AUCTION')),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SOLD','CANCELLED','EXPIRED')),
  price           bigint NOT NULL CHECK (price > 0),          -- asking price (FIXED) or start price (AUCTION)
  reference_value bigint NOT NULL CHECK (reference_value > 0),
  ends_at         timestamptz NOT NULL,
  highest_bid     bigint,
  highest_bidder  uuid REFERENCES users(id),
  bid_count       integer NOT NULL DEFAULT 0,
  buyer_id        uuid REFERENCES users(id),
  sale_price      bigint,
  fee             bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  CHECK (buyer_id IS NULL OR buyer_id <> seller_id),
  CHECK (highest_bidder IS NULL OR highest_bidder <> seller_id),
  CHECK ((highest_bid IS NULL) = (highest_bidder IS NULL)),
  CHECK (status <> 'SOLD' OR (buyer_id IS NOT NULL AND sale_price IS NOT NULL AND fee IS NOT NULL))
);
-- A horse can have at most one live listing.
CREATE UNIQUE INDEX market_listings_one_active ON market_listings (horse_id) WHERE status = 'ACTIVE';
CREATE INDEX market_listings_browse ON market_listings (status, ends_at);
CREATE INDEX market_listings_seller ON market_listings (seller_id, created_at DESC);
CREATE INDEX market_listings_due ON market_listings (ends_at) WHERE status = 'ACTIVE';

CREATE TABLE market_bids (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES market_listings(id),
  bidder_id   uuid NOT NULL REFERENCES users(id),
  amount      bigint NOT NULL CHECK (amount > 0),
  status      text NOT NULL DEFAULT 'LEADING' CHECK (status IN ('LEADING','OUTBID','WON','REFUNDED')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Exactly one leading bid per auction at any time.
CREATE UNIQUE INDEX market_bids_one_leading ON market_bids (listing_id) WHERE status = 'LEADING';
CREATE INDEX market_bids_listing ON market_bids (listing_id, created_at DESC);
CREATE INDEX market_bids_bidder ON market_bids (bidder_id, created_at DESC);
