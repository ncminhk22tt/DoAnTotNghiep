const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.warn(".env.local not found. Using environment variables.");
    return;
  }

  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function columnExists(conn, table, column) {
  // Some MySQL versions don't accept parameter placeholders in SHOW COLUMNS LIKE.
  // Use connection.escape to safely interpolate the column name.
  const sql = `SHOW COLUMNS FROM \`${table}\` LIKE ${conn.escape(column)}`;
  const [rows] = await conn.query(sql);
  return rows.length > 0;
}

async function main() {
  loadEnvLocal();

  const host =
    process.env.DB_HOST === "localhost"
      ? "127.0.0.1"
      : process.env.DB_HOST || "127.0.0.1";
  const port = Number(process.env.DB_PORT) || 3306;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME || "medical_booking";

  if (!user || password === undefined) {
    throw new Error(
      "Missing DB_USER or DB_PASSWORD. Please create .env.local or set these env vars."
    );
  }

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
  });

  try {
    const hasPaymentStatus = await columnExists(conn, "appointments", "payment_status");
    if (!hasPaymentStatus) {
      console.log("Adding appointments.payment_status and paid_at...");
      await conn.execute(
        `ALTER TABLE appointments
         ADD COLUMN payment_status ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
         ADD COLUMN paid_at DATETIME NULL`
      );
      console.log("Added appointments.payment_status and paid_at");
    } else {
      console.log("appointments.payment_status already exists");
    }

    const [paymentTableRows] = await conn.execute(
      `SELECT 1
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'payments'
       LIMIT 1`,
      [database]
    );

    if (paymentTableRows.length === 0) {
      console.log("Creating payments table...");
      await conn.execute(
        `CREATE TABLE payments (
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
        )`
      );
      console.log("Created payments table");
    } else {
      console.log("payments table already exists");
    }

    console.log("Payment schema migration completed.");
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("migrate-payment-schema failed:", error);
  process.exit(1);
});
