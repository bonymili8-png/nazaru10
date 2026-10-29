-- Racing careers age more slowly: from 2 years old a game year now lasts 98 real days instead
-- of 28 (lifecycle.adultRealDaysPerGameYear). Move the birth dates of horses already past 2 so
-- every horse keeps exactly the age it has now: old elapsed E days (age E/28) becomes
-- 56 + (E − 56) × 98/28 days.
UPDATE horses
   SET birth_at = now() - interval '56 days'
                - (extract(epoch FROM now() - birth_at) / 86400 - 56) * 3.5 * interval '1 day'
 WHERE birth_at < now() - interval '56 days';
