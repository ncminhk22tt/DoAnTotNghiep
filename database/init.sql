CREATE DATABASE IF NOT EXISTS medical_booking;

USE medical_booking;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT UNIQUE,
  phone VARCHAR(20) NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  avatar VARCHAR(255) DEFAULT 'default-avatar.png',
  role ENUM('patient','doctor','admin') NOT NULL DEFAULT 'patient',
  status ENUM('active','inactive','banned') NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (phone)
);

CREATE TABLE IF NOT EXISTS specialties (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100),
  description TEXT,
  logo_url VARCHAR(255) NULL,
  head_doctor_user_id BIGINT NULL,
  deputy_doctor_user_id BIGINT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  specialty_id BIGINT,
  description TEXT,
  logo_url VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  deleted_at DATETIME NULL,
  UNIQUE KEY unique_service_name (name),
  KEY idx_services_specialty_id (specialty_id)
);

CREATE TABLE IF NOT EXISTS doctors (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT,
  specialty_id BIGINT,
  experience INT,
  description TEXT,
  status ENUM('pending','active') DEFAULT 'pending',
  doctor_code VARCHAR(20) UNIQUE
);

CREATE TABLE IF NOT EXISTS doctor_services (
  doctor_id BIGINT NOT NULL,
  service_id BIGINT NOT NULL,
  specialty_id BIGINT,
  PRIMARY KEY (doctor_id, service_id),
  KEY idx_doctor_services_specialty_id (specialty_id)
);

CREATE TABLE IF NOT EXISTS doctor_specialties (
  doctor_id BIGINT NOT NULL,
  specialty_id BIGINT NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (doctor_id, specialty_id),
  KEY idx_doctor_specialties_specialty_id (specialty_id),
  KEY idx_doctor_specialties_primary (doctor_id, is_primary)
);

CREATE TABLE IF NOT EXISTS code_sequences (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(50),
  year INT,
  current_value INT,
  UNIQUE KEY unique_type_year (type, year)
);

CREATE TABLE IF NOT EXISTS doctor_schedules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  doctor_id BIGINT,
  date DATE,
  time_slot VARCHAR(50),
  is_available BOOLEAN,
  UNIQUE KEY unique_schedule (doctor_id, date, time_slot)
);

CREATE TABLE IF NOT EXISTS appointments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT,
  slot_id BIGINT,
  doctor_id BIGINT,
  schedule_id BIGINT,
  status ENUM('pending','confirmed','completed','cancelled','no_show'),
  payment_status ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
  paid_at DATETIME NULL,
  note TEXT,
  admin_note TEXT NULL,
  checked_in_at DATETIME NULL,
  checked_in_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  appointment_day DATE NULL,
  active_slot_id BIGINT GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('pending', 'confirmed') THEN slot_id
      ELSE NULL
    END
  ) STORED,
  active_appointment_day DATE GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('pending', 'confirmed') THEN appointment_day
      ELSE NULL
    END
  ) STORED,
  UNIQUE KEY uniq_active_appointment_slot (active_slot_id),
  UNIQUE KEY uniq_active_user_day (user_id, active_appointment_day)
);

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

CREATE TABLE IF NOT EXISTS appointment_waitlist (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  slot_id BIGINT NOT NULL,
  note TEXT NULL,
  status ENUM('waiting','notified','booked','cancelled') NOT NULL DEFAULT 'waiting',
  notified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_waiting_user_slot (user_id, slot_id),
  KEY idx_waitlist_slot_status_created (slot_id, status, created_at),
  KEY idx_waitlist_user_status_created (user_id, status, created_at)
);

CREATE TABLE IF NOT EXISTS medical_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT,
  diagnosis TEXT,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  medical_record_id BIGINT
);

CREATE TABLE IF NOT EXISTS prescription_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  prescription_id BIGINT,
  medicine_name VARCHAR(100),
  dosage VARCHAR(100),
  duration VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT,
  message TEXT,
  action_url VARCHAR(255) NULL,
  is_read BOOLEAN DEFAULT false,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token VARCHAR(128) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  jti VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_refresh_user_expires (user_id, expires_at),
  KEY idx_refresh_jti (jti)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NULL,
  entity_id BIGINT NULL,
  status ENUM('success', 'failed') NOT NULL DEFAULT 'success',
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  detail TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_user_created (user_id, created_at),
  KEY idx_audit_action_created (action, created_at)
);

CREATE TABLE IF NOT EXISTS medical_record_files (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  medical_record_id BIGINT NOT NULL,
  uploaded_by_user_id BIGINT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NULL,
  file_size BIGINT NULL,
  storage_path VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mrf_record_created (medical_record_id, created_at)
);

CREATE TABLE IF NOT EXISTS medical_record_revisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  medical_record_id BIGINT NOT NULL,
  edited_by_user_id BIGINT NULL,
  diagnosis TEXT NULL,
  notes LONGTEXT NULL,
  prescription_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mrr_record_created (medical_record_id, created_at)
);

CREATE TABLE IF NOT EXISTS doctor_reviews (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  doctor_id BIGINT NOT NULL,
  appointment_id BIGINT NOT NULL,
  medical_record_id BIGINT NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_appointment_review (user_id, appointment_id),
  KEY idx_doctor_reviews_doctor (doctor_id),
  KEY idx_doctor_reviews_appointment (appointment_id)
);

CREATE TABLE IF NOT EXISTS appointment_reminders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT NOT NULL,
  reminder_type ENUM('before_visit') NOT NULL DEFAULT 'before_visit',
  reminded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_appointment_reminder_type (appointment_id, reminder_type),
  KEY idx_appointment_reminders_reminded_at (reminded_at)
);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key VARCHAR(190) PRIMARY KEY,
  window_start_ms BIGINT NOT NULL,
  request_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_rate_limit_updated_at (updated_at)
);
