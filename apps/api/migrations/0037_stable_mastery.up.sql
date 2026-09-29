-- Stable mastery counts an owner's completed training sessions on every stable view, training
-- start and race settlement; keep that count an index-only lookup.
CREATE INDEX training_owner_completed ON training_sessions (owner_id) WHERE status = 'COMPLETED';
