-- Invites that share a (non-public) sign-in address with the referrer are held for review
-- instead of being refused outright (mobile carriers put many subscribers behind one address).
ALTER TABLE fraud_flags DROP CONSTRAINT fraud_flags_kind_check;
ALTER TABLE fraud_flags ADD CONSTRAINT fraud_flags_kind_check
  CHECK (kind IN ('SHARED_IP','CIRCULAR_TRADE','TRADE_FUNNEL','REFERRAL_CLUSTER','INCOME_SPIKE','REFERRAL_SHARED_IP'));
