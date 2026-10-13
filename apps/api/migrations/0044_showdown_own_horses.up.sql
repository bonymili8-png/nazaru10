-- Showdowns, third mode: players race 1–3 horses from their own stables (no pace horses).
ALTER TABLE showdowns DROP CONSTRAINT IF EXISTS showdowns_mode_check;
ALTER TABLE showdowns ADD CONSTRAINT showdowns_mode_check CHECK (mode IN ('NORMAL', 'NO_FATIGUE', 'OWN_HORSES'));
-- A tournament horse in the other modes; the entered stable horses in OWN_HORSES.
ALTER TABLE showdown_players ALTER COLUMN horse DROP NOT NULL;
ALTER TABLE showdown_players ADD COLUMN horse_ids uuid[];
