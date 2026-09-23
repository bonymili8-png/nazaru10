DROP INDEX horses_parents;
DROP TABLE breeding_events;
DROP TABLE studs;
UPDATE horses SET status = 'IDLE' WHERE status = 'BREEDING';
ALTER TABLE horses DROP CONSTRAINT horses_status_check;
ALTER TABLE horses ADD CONSTRAINT horses_status_check
  CHECK (status IN ('IDLE','TRAINING','ENTERED','RACING','INJURED','LISTED','RETIRED'));
