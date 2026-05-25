CREATE TABLE IF NOT EXISTS payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'VND',
  status ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
  method VARCHAR(50) NULL,
  transaction_reference VARCHAR(255) NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_payments_appointment_id (appointment_id),
  KEY idx_payments_status_created (status, created_at)
);
