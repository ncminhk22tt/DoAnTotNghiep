const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const { getLocalDbConfig } = require("./db-local.cjs");

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function main() {
  const db = getLocalDbConfig();

  const phone = requireEnv("ADMIN_PHONE");
  const password = requireEnv("ADMIN_PASSWORD");
  const fullName = requireEnv("ADMIN_FULL_NAME");
  const email = requireEnv("ADMIN_EMAIL");

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
