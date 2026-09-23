ALTER TABLE tournament_entries DROP CONSTRAINT tournament_entries_heat_fk;
ALTER TABLE tournaments DROP CONSTRAINT tournaments_final_race_fk;
DROP INDEX races_tournament;
ALTER TABLE races DROP CONSTRAINT races_tournament_stage;
ALTER TABLE races DROP COLUMN stage;
ALTER TABLE races DROP COLUMN tournament_id;
DROP TABLE tournament_entries;
DROP TABLE tournaments;
