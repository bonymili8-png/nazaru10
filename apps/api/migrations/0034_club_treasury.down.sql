ALTER TABLE clubs DROP COLUMN chat_url, DROP COLUMN level;
DELETE FROM ledger_entries WHERE account_id IN (SELECT id FROM accounts WHERE owner_type = 'CLUB');
DELETE FROM accounts WHERE owner_type = 'CLUB';
ALTER TABLE accounts DROP CONSTRAINT accounts_owner_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_owner_type_check CHECK (owner_type IN ('USER','SYSTEM','ESCROW'));
