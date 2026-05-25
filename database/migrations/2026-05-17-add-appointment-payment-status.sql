ALTER TABLE appointments
  ADD COLUMN payment_status ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
  ADD COLUMN paid_at DATETIME NULL;
