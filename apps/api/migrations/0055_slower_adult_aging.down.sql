UPDATE horses
   SET birth_at = now() - interval '56 days'
                - (extract(epoch FROM now() - birth_at) / 86400 - 56) / 3.5 * interval '1 day'
 WHERE birth_at < now() - interval '56 days';
