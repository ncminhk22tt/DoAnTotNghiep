-- Enforce one active appointment per slot.
-- Existing duplicate active appointments must be cleaned up before running this migration.

ALTER TABLE appointments
  ADD COLUMN active_slot_id BIGINT GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('pending', 'confirmed') THEN slot_id
      ELSE NULL
    END
  ) STORED,
  ADD UNIQUE KEY uniq_active_appointment_slot (active_slot_id);
