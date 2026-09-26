ALTER TABLE stables DROP COLUMN crest;
DELETE FROM owned_cosmetics WHERE item LIKE 'crest:%';
