DELETE FROM showdowns WHERE mode = 'OWN_HORSES';
ALTER TABLE showdown_players DROP COLUMN IF EXISTS horse_ids;
ALTER TABLE showdown_players ALTER COLUMN horse SET NOT NULL;
ALTER TABLE showdowns DROP CONSTRAINT IF EXISTS showdowns_mode_check;
ALTER TABLE showdowns ADD CONSTRAINT showdowns_mode_check CHECK (mode IN ('NORMAL', 'NO_FATIGUE'));
