DROP INDEX horses_feed_due;
ALTER TABLE horses
  DROP CONSTRAINT horses_feed_period,
  DROP COLUMN feed_periods,
  DROP COLUMN feed_renews,
  DROP COLUMN feed_paid_until,
  DROP COLUMN feed_plan;
