-- Club treasury (a ledger account owned by the club; donations only, spent on club levels) and
-- an optional Telegram group link shown to members.
ALTER TABLE accounts DROP CONSTRAINT accounts_owner_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_owner_type_check CHECK (owner_type IN ('USER','SYSTEM','ESCROW','CLUB'));
ALTER TABLE clubs
  ADD COLUMN level integer NOT NULL DEFAULT 1 CHECK (level >= 1),
  ADD COLUMN chat_url text;
