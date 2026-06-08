-- Enforce one active appointment per patient per clinic day.
-- Existing duplicate active appointments must be cleaned up before running this migration.

ALTER TABLE appointments
  ADD COLUMN appointment_day DATE NULL;

UPDATE appointments a
JOIN doctor_schedule_slots s ON s.id = a.slot_id
SET a.appointment_day = s.work_date
WHERE a.appointment_day IS NULL;

ALTER TABLE appointments
  ADD COLUMN active_appointment_day DATE GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('pending', 'confirmed') THEN appointment_day
      ELSE NULL
    END
  ) STORED,
  ADD UNIQUE KEY uniq_active_user_day (user_id, active_appointment_day);
