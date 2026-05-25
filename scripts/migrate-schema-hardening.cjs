const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function tableExists(conn, dbName, tableName) {
  const [rows] = await conn.execute(
    `SELECT 1
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     LIMIT 1`,
    [dbName, tableName]
  );
  return rows.length > 0;
}

async function indexExists(conn, dbName, tableName, indexName) {
  const [rows] = await conn.execute(
    `SELECT 1
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [dbName, tableName, indexName]
  );
  return rows.length > 0;
}

async function addIndexIfMissing(conn, dbName, tableName, indexName, ddl) {
  const exists = await indexExists(conn, dbName, tableName, indexName);
  if (!exists) {
    await conn.execute(ddl);
    console.log(`Added index ${indexName}`);
  } else {
    console.log(`Index exists ${indexName}`);
  }
}

async function main() {
  loadEnvLocal();

  const dbName = process.env.DB_NAME || "medical_booking";
  const host =
    process.env.DB_HOST === "localhost"
      ? "127.0.0.1"
      : process.env.DB_HOST || "127.0.0.1";

  const conn = await mysql.createConnection({
    host,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 3306,
    database: dbName,
  });

  try {
    const hasSlotsTable = await tableExists(conn, dbName, "doctor_schedule_slots");
    if (!hasSlotsTable) {
      await conn.execute(
        `CREATE TABLE doctor_schedule_slots (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          doctor_id BIGINT NOT NULL,
          service_id BIGINT NOT NULL,
          work_date DATE NOT NULL,
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          room VARCHAR(50) DEFAULT NULL,
          price DECIMAL(10,2) DEFAULT NULL,
          max_patients INT DEFAULT 1,
          booked_count INT DEFAULT 0,
          status ENUM('available','full','closed') DEFAULT 'available',
          UNIQUE KEY unique_slot (doctor_id, work_date, start_time)
        )`
      );
      console.log("Created table doctor_schedule_slots");
    } else {
      console.log("Table exists doctor_schedule_slots");
    }

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        token VARCHAR(128) NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    console.log("Ensured table password_reset_tokens");

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        token_hash VARCHAR(128) NOT NULL UNIQUE,
        jti VARCHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME NULL,
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    console.log("Ensured table auth_refresh_tokens");

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NULL,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50) NULL,
        entity_id BIGINT NULL,
        status ENUM('success', 'failed') NOT NULL DEFAULT 'success',
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL,
        detail TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    console.log("Ensured table audit_logs");

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS medical_record_files (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        medical_record_id BIGINT NOT NULL,
        uploaded_by_user_id BIGINT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) NULL,
        file_size BIGINT NULL,
        storage_path VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    console.log("Ensured table medical_record_files");
    await conn.execute(
      `CREATE TABLE IF NOT EXISTS appointment_reminders (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        appointment_id BIGINT NOT NULL,
        reminder_type ENUM('before_visit') NOT NULL DEFAULT 'before_visit',
        reminded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_appointment_reminder_type (appointment_id, reminder_type)
      )`
    );
    console.log("Ensured table appointment_reminders");

    await conn.execute("UPDATE appointments SET created_at = NOW() WHERE created_at IS NULL");
    await conn.execute(
      "ALTER TABLE appointments MODIFY created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
    );
    await conn.execute(
      "ALTER TABLE medical_records MODIFY created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
    );
    await conn.execute(
      "ALTER TABLE notifications MODIFY created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
    );
    await conn.execute(
      "ALTER TABLE notifications MODIFY is_read BOOLEAN NOT NULL DEFAULT false"
    );

    await addIndexIfMissing(
      conn,
      dbName,
      "appointments",
      "idx_appointments_user_status",
      "CREATE INDEX idx_appointments_user_status ON appointments (user_id, status)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "appointments",
      "idx_appointments_slot_id",
      "CREATE INDEX idx_appointments_slot_id ON appointments (slot_id)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "doctor_schedule_slots",
      "idx_slot_doctor_date",
      "CREATE INDEX idx_slot_doctor_date ON doctor_schedule_slots (doctor_id, work_date)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "doctor_schedule_slots",
      "idx_slot_status",
      "CREATE INDEX idx_slot_status ON doctor_schedule_slots (status)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "medical_records",
      "idx_medical_records_appointment_id",
      "CREATE INDEX idx_medical_records_appointment_id ON medical_records (appointment_id)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "notifications",
      "idx_notifications_user_read_created",
      "CREATE INDEX idx_notifications_user_read_created ON notifications (user_id, is_read, created_at)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "password_reset_tokens",
      "idx_password_reset_token_user_expires",
      "CREATE INDEX idx_password_reset_token_user_expires ON password_reset_tokens (user_id, expires_at)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "auth_refresh_tokens",
      "idx_refresh_user_expires",
      "CREATE INDEX idx_refresh_user_expires ON auth_refresh_tokens (user_id, expires_at)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "auth_refresh_tokens",
      "idx_refresh_jti",
      "CREATE INDEX idx_refresh_jti ON auth_refresh_tokens (jti)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "audit_logs",
      "idx_audit_user_created",
      "CREATE INDEX idx_audit_user_created ON audit_logs (user_id, created_at)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "audit_logs",
      "idx_audit_action_created",
      "CREATE INDEX idx_audit_action_created ON audit_logs (action, created_at)"
    );
    await addIndexIfMissing(
      conn,
      dbName,
      "medical_record_files",
      "idx_mrf_record_created",
      "CREATE INDEX idx_mrf_record_created ON medical_record_files (medical_record_id, created_at)"
    );


    await addIndexIfMissing(
      conn,
      dbName,
      "appointment_reminders",
      "idx_appointment_reminders_reminded_at",
      "CREATE INDEX idx_appointment_reminders_reminded_at ON appointment_reminders (reminded_at)"
    );
    console.log("Schema hardening migration completed.");
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("migrate-schema-hardening failed:", error);
  process.exit(1);
});


