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

async function columnExists(conn, dbName, tableName, columnName) {
  const [rows] = await conn.execute(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [dbName, tableName, columnName]
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
    const hasColumn = await columnExists(
      conn,
      dbName,
      "doctor_services",
      "specialty_id"
    );

    if (!hasColumn) {
      await conn.execute(
        "ALTER TABLE doctor_services ADD COLUMN specialty_id BIGINT NULL AFTER service_id"
      );
      console.log("Added column: doctor_services.specialty_id");
    } else {
      console.log("Column exists: doctor_services.specialty_id");
    }

    const hasIndex = await indexExists(
      conn,
      dbName,
      "doctor_services",
      "idx_doctor_services_specialty_id"
    );

    if (!hasIndex) {
      await conn.execute(
        "CREATE INDEX idx_doctor_services_specialty_id ON doctor_services (specialty_id)"
      );
      console.log("Added index: idx_doctor_services_specialty_id");
    } else {
      console.log("Index exists: idx_doctor_services_specialty_id");
    }

    const [updateResult] = await conn.execute(
      `UPDATE doctor_services ds
       JOIN services s ON s.id = ds.service_id
       SET ds.specialty_id = s.specialty_id
       WHERE ds.specialty_id IS NULL`
    );

    console.log("Backfilled rows:", updateResult.affectedRows || 0);
    console.log("Migration completed.");
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
