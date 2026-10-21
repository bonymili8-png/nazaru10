-- Owner decision (2026-10): the shared-address filter was far too strict (and, without the
-- Railway proxy hop trusted, saw the proxy's address instead of the players'). Every open
-- network flag is approved once; referral rewards held by them are then paid by the sweep,
-- and trust is recomputed by the job runner. Trade and income flags are left for review.
WITH approved AS (
  UPDATE fraud_flags
     SET status = 'DISMISSED', reviewed_at = now(),
         review_note = 'Bulk-approved by the owner after the filter review (network flags were too strict)'
   WHERE status = 'OPEN' AND kind IN ('SHARED_IP', 'REFERRAL_SHARED_IP', 'REFERRAL_CLUSTER')
  RETURNING id, kind
)
INSERT INTO audit_logs (actor_id, action, target_type, target_id, before, after, reason)
SELECT NULL, 'FRAUD_FLAGS_BULK_DISMISSED', 'fraud_flags', 'network-flags-2026-10',
       '{"status":"OPEN"}'::jsonb,
       jsonb_build_object('status', 'DISMISSED', 'count', count(*),
                          'byKind', (SELECT jsonb_object_agg(kind, n)
                                       FROM (SELECT kind, count(*) AS n FROM approved GROUP BY kind) k)),
       'Owner decision: approve all existing network flags after loosening the filter'
  FROM approved
HAVING count(*) > 0;
