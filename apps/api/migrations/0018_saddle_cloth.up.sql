-- Saddle cloth per horse (cosmetic only; patterns unlocked per owner via owned_cosmetics).
ALTER TABLE horses ADD COLUMN cloth jsonb;
