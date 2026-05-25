ALTER TABLE users
  ADD COLUMN gender ENUM('male','female') NULL AFTER avatar,
  ADD COLUMN birth_year INT NULL AFTER gender;
