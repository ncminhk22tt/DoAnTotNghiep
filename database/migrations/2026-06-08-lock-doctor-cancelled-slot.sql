ALTER TABLE doctor_schedule_slots
  MODIFY COLUMN status ENUM('available','full','closed','locked') NOT NULL DEFAULT 'available';
