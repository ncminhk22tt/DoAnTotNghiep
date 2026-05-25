ALTER TABLE specialties
ADD COLUMN head_doctor_user_id BIGINT NULL AFTER description,
ADD COLUMN deputy_doctor_user_id BIGINT NULL AFTER head_doctor_user_id;

