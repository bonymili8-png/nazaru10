-- Gear wear: races used per owned item (an item wears out after config gearWear.races).
ALTER TABLE stables ADD COLUMN gear_wear jsonb NOT NULL DEFAULT '{}'::jsonb;
