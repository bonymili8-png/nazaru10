-- Stable crest: an emblem beside the stable name (cosmetic only; emblems unlocked via owned_cosmetics).
ALTER TABLE stables ADD COLUMN crest jsonb NOT NULL
  DEFAULT '{"shape":"SHIELD","icon":"HORSESHOE","field":"black","charge":"gold"}'::jsonb;
