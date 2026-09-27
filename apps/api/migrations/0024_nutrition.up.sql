-- Feed plans: per horse, weekly, paid in advance in credits. STANDARD is free and has no period.
ALTER TABLE horses
  ADD COLUMN feed_plan       text NOT NULL DEFAULT 'STANDARD' CHECK (feed_plan IN ('STANDARD','PREMIUM','ELITE')),
  ADD COLUMN feed_paid_until timestamptz,
  ADD COLUMN feed_renews     boolean NOT NULL DEFAULT true,
  ADD COLUMN feed_periods    integer NOT NULL DEFAULT 0 CHECK (feed_periods >= 0),
  ADD CONSTRAINT horses_feed_period CHECK ((feed_plan = 'STANDARD') = (feed_paid_until IS NULL));
CREATE INDEX horses_feed_due ON horses (feed_paid_until) WHERE feed_plan <> 'STANDARD';
