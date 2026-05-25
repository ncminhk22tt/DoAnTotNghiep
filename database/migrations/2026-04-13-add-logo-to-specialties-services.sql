SET @has_specialties_logo := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'specialties'
    AND column_name = 'logo_url'
);
SET @sql_specialties_logo := IF(
  @has_specialties_logo = 0,
  'ALTER TABLE specialties ADD COLUMN logo_url VARCHAR(255) NULL AFTER description',
  'SELECT 1'
);
PREPARE stmt_specialties_logo FROM @sql_specialties_logo;
EXECUTE stmt_specialties_logo;
DEALLOCATE PREPARE stmt_specialties_logo;

SET @has_services_logo := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'services'
    AND column_name = 'logo_url'
);
SET @sql_services_logo := IF(
  @has_services_logo = 0,
  'ALTER TABLE services ADD COLUMN logo_url VARCHAR(255) NULL AFTER description',
  'SELECT 1'
);
PREPARE stmt_services_logo FROM @sql_services_logo;
EXECUTE stmt_services_logo;
DEALLOCATE PREPARE stmt_services_logo;
