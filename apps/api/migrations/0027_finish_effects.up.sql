-- Finish effect: the stable's celebration shown when one of its horses wins (cosmetic only).
ALTER TABLE stables ADD COLUMN finish_effect text NOT NULL DEFAULT 'CONFETTI'
  CHECK (finish_effect IN ('NONE','CONFETTI','FIREWORKS','GOLD_RAIN','ROSES','LIGHTNING'));
