ALTER TABLE horses DROP COLUMN cloth;
DELETE FROM owned_cosmetics WHERE item LIKE 'cloth:%';
