DROP TABLE IF EXISTS content_media;
DROP TABLE IF EXISTS social_posts;
DROP TABLE IF EXISTS social_accounts;
DELETE FROM marketing_channels WHERE channel <> 'TELEGRAM';
