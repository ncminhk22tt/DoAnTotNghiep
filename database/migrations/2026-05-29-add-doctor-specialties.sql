CREATE TABLE IF NOT EXISTS doctor_specialties (
  doctor_id BIGINT NOT NULL,
  specialty_id BIGINT NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (doctor_id, specialty_id),
  KEY idx_doctor_specialties_specialty_id (specialty_id),
  KEY idx_doctor_specialties_primary (doctor_id, is_primary)
);

INSERT INTO doctor_specialties (doctor_id, specialty_id, is_primary)
SELECT id, specialty_id, 1
FROM doctors
WHERE specialty_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  is_primary = VALUES(is_primary);
