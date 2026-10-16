-- Why a tournament was called off, for its page and the owners' history.
ALTER TABLE tournaments ADD COLUMN cancel_reason text;
-- Earlier cancellations recorded the reason only in their outbox event.
UPDATE tournaments t SET cancel_reason = e.payload->>'reason'
  FROM domain_events e
 WHERE t.status = 'CANCELLED' AND e.type = 'tournament_cancelled'
   AND e.aggregate_id = t.id::text AND e.payload ? 'reason';
-- History: finished tournaments newest first.
CREATE INDEX tournaments_finished ON tournaments (heats_at DESC) WHERE status IN ('COMPLETED', 'CANCELLED');
