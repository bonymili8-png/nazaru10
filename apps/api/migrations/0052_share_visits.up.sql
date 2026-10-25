-- Visits to public share pages (replays, horse cards), counted per day, page and sharer.
CREATE TABLE share_visits (
  day       date    NOT NULL,
  kind      text    NOT NULL CHECK (kind IN ('race', 'horse')),
  target    uuid    NOT NULL,
  -- The sharer's referral code from the link ('' when the link had none).
  ref_code  text    NOT NULL DEFAULT '',
  visits    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, target, ref_code)
);
CREATE INDEX share_visits_ref ON share_visits (ref_code, day) WHERE ref_code <> '';
