-- Announcements to every player in the bot: horses the team lists in the shop, special races the
-- team creates. Several of the same kind created close together go out as one message.
CREATE TABLE announcements (
  id            bigserial PRIMARY KEY,
  kind          text        NOT NULL CHECK (kind IN ('SHOP_HORSES','SPECIAL_RACES')),
  items         jsonb       NOT NULL DEFAULT '[]',
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL,
  send_after    timestamptz NOT NULL,
  started_at    timestamptz,
  -- Players are messaged in id order; the last one reached (resumes after a restart).
  cursor_user   uuid,
  sent          integer     NOT NULL DEFAULT 0,
  skipped       integer     NOT NULL DEFAULT 0,
  failed        integer     NOT NULL DEFAULT 0,
  done_at       timestamptz,
  cancelled_at  timestamptz,
  cancelled_by  uuid REFERENCES users(id)
);
CREATE INDEX announcements_due ON announcements (send_after) WHERE done_at IS NULL AND cancelled_at IS NULL;

-- Horses already on limited sale when this shipped (with at least an hour left) are announced once.
INSERT INTO announcements (kind, items, created_at, send_after)
SELECT 'SHOP_HORSES',
       jsonb_agg(jsonb_build_object('horseId', h.id, 'name', h.name, 'rarity', h.rarity,
                                    'price', h.sale_price, 'endsAt', h.sale_ends_at) ORDER BY h.sale_ends_at),
       now(), now()
  FROM horses h
 WHERE h.is_house AND h.house_class = 'LIMITED' AND h.sale_price IS NOT NULL
   AND h.sale_ends_at > now() + interval '1 hour'
HAVING count(*) > 0;
