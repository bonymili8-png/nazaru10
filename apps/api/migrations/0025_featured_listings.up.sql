-- Featured market listings: sellers pay gems to pin a live listing at the top (visibility only).
ALTER TABLE market_listings
  ADD COLUMN featured_until timestamptz,
  ADD COLUMN featured_count integer NOT NULL DEFAULT 0 CHECK (featured_count >= 0);
