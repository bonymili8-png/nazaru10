-- Stable facilities (levels; effects and costs live in config).
ALTER TABLE stables ADD COLUMN training_track smallint NOT NULL DEFAULT 0 CHECK (training_track BETWEEN 0 AND 10);
ALTER TABLE stables ADD COLUMN vet_clinic smallint NOT NULL DEFAULT 0 CHECK (vet_clinic BETWEEN 0 AND 10);
