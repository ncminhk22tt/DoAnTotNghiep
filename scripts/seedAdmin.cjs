const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

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

async function main() {
  loadEnvLocal();

  const phone = process.env.ADMIN_PHONE || "+84900000000";
  const password = process.env.ADMIN_PASSWORD || "123456";
  const fullName = process.env.ADMIN_FULL_NAME || "Administrator";
  const email = process.env.ADMIN_EMAIL || "admin@medical-booking.local";

  const host = process.env.DB_HOST === "localhost" ? "127.0.0.1" : (process.env.DB_HOST || "127.0.0.1");

  const conn = await mysql.createConnection({
    host,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "medical_booking",
    port: Number(process.env.DB_PORT) || 3306,
  });

  const [rows] = await conn.query(
    "SELECT phone FROM users WHERE phone = ? LIMIT 1",
    [phone]
  );

  if (rows.length > 0) {
    console.log("Admin da ton tai");
    await conn.end();
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const [result] = await conn.query(
    "INSERT INTO users (phone, password, full_name, email, role, status, created_at) VALUES (?, ?, ?, ?, 'admin', 'active', NOW())",
    [phone, hashedPassword, fullName, email]
  );

  console.log("Tao admin thanh cong voi ID:", result.insertId);
  await conn.end();
}

main().catch((error) => {
  console.error("Loi seed admin:", error.message || error);
  process.exit(1);
});
