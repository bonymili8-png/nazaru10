-- Race-day gear: bought once per stable, one item chosen per race entry.
ALTER TABLE stables ADD COLUMN gear text[] NOT NULL DEFAULT '{}';
ALTER TABLE race_entries ADD COLUMN gear text
  CHECK (gear IN ('BLINKERS','SHADOW_ROLL','TONGUE_TIE','RACING_PLATES','CROSS_NOSEBAND'));
