-- Daily care between starts (free: the owner's time). See engine care/index.ts.
ALTER TABLE horses
  ADD COLUMN bond            real        NOT NULL DEFAULT 0 CHECK (bond >= 0 AND bond <= 100),
  ADD COLUMN bond_at         timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN care_last       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN shoe_starts     integer     NOT NULL DEFAULT 0 CHECK (shoe_starts >= 0),
  ADD COLUMN massaged        boolean     NOT NULL DEFAULT false,
  ADD COLUMN last_race_at    timestamptz,
  ADD COLUMN hosed_last_race boolean     NOT NULL DEFAULT false;
