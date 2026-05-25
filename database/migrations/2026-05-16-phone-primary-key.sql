-- Migration: Drop legacy username column and make phone the primary key on users.
-- Run this against existing databases that still have the legacy username column.

ALTER TABLE users
  DROP PRIMARY KEY,
  DROP COLUMN IF EXISTS username,
  MODIFY COLUMN phone VARCHAR(20) NOT NULL,
  ADD UNIQUE KEY uniq_users_id (id),
  ADD PRIMARY KEY (phone);
