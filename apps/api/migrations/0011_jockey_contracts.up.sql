-- Retained jockeys share the staff contract lifecycle with trainers.
ALTER TABLE staff_contracts ALTER COLUMN trainer_id DROP NOT NULL;
ALTER TABLE staff_contracts ADD COLUMN jockey_id uuid REFERENCES jockeys(id);
ALTER TABLE staff_contracts ADD CONSTRAINT staff_contracts_one_kind
  CHECK ((trainer_id IS NULL) <> (jockey_id IS NULL));
CREATE UNIQUE INDEX staff_contracts_one_active_jockey ON staff_contracts (jockey_id)
  WHERE ended_at IS NULL AND jockey_id IS NOT NULL;
