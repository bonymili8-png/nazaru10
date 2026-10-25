DROP TABLE IF EXISTS marketing_channels;
DROP TABLE IF EXISTS content_items;
DELETE FROM campaigns WHERE created_by IS NULL;
ALTER TABLE campaigns ALTER COLUMN created_by SET NOT NULL;
