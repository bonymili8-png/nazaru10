-- Clubs: player groups ranked by their members' season points.
CREATE TABLE clubs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  tag           text NOT NULL,
  description   text NOT NULL DEFAULT '',
  owner_id      uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  disbanded_at  timestamptz
);
-- Names and tags are unique among active clubs, case-insensitively.
CREATE UNIQUE INDEX clubs_active_name ON clubs (lower(name)) WHERE disbanded_at IS NULL;
CREATE UNIQUE INDEX clubs_active_tag ON clubs (upper(tag)) WHERE disbanded_at IS NULL;

-- One club per player (the primary key enforces it).
CREATE TABLE club_members (
  user_id    uuid PRIMARY KEY REFERENCES users(id),
  club_id    uuid NOT NULL REFERENCES clubs(id),
  role       text NOT NULL CHECK (role IN ('OWNER','MEMBER')),
  joined_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX club_members_club ON club_members (club_id, joined_at);

ALTER TABLE users ADD COLUMN club_left_at timestamptz;
