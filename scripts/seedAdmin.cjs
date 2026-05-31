const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const { getLocalDbConfig } = require("./db-local.cjs");

async function main() {
  const db = getLocalDbConfig();

  const phone = process.env.ADMIN_PHONE || "+84900000000";
  const password = process.env.ADMIN_PASSWORD || "123456";
  const fullName = process.env.ADMIN_FULL_NAME || "Administrator";
  const email = process.env.ADMIN_EMAIL || "admin@medical-booking.local";

  const conn = await mysql.createConnection({
    host: db.host,
    user: db.user,
    password: db.password,
    database: db.database,
    port: db.port,
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
