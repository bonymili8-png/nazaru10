-- Whether this cup runs on house horses too (one entrant is enough; the final has a full field).
-- Taken from the admin switch at the draw, so flipping it never changes a cup already drawn.
ALTER TABLE tournaments ADD COLUMN house_fill boolean NOT NULL DEFAULT false;
