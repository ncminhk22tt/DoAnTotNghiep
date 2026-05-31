const mysql = require("mysql2/promise");
const { getLocalDbConfig } = require("./db-local.cjs");

async function columnExists(conn, table, column) {
  const sql = `SHOW COLUMNS FROM \`${table}\` LIKE ${conn.escape(column)}`;
  const [rows] = await conn.query(sql);
  return rows.length > 0;
}

async function main() {
  const db = getLocalDbConfig();

  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
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
      [db.database]
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
