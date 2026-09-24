DELETE FROM staff_contracts WHERE jockey_id IS NOT NULL;
DROP INDEX staff_contracts_one_active_jockey;
ALTER TABLE staff_contracts DROP CONSTRAINT staff_contracts_one_kind;
ALTER TABLE staff_contracts DROP COLUMN jockey_id;
ALTER TABLE staff_contracts ALTER COLUMN trainer_id SET NOT NULL;
