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
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadEnvLocal();

  const host =
    process.env.DB_HOST === "localhost"
      ? "127.0.0.1"
      : process.env.DB_HOST || "127.0.0.1";

  const sqlPath = path.join(process.cwd(), "database", "init.sql");
  let initSql = fs.readFileSync(sqlPath, "utf8");
  if (initSql.charCodeAt(0) === 0xfeff) {
    initSql = initSql.slice(1);
  }

  const conn = await mysql.createConnection({
    host,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 3306,
    multipleStatements: true,
  });

  await conn.query(initSql);

  const [tables] = await conn.query("SHOW TABLES FROM medical_booking");
  console.log("Initialized DB. Tables:", tables);

  await conn.end();
}

main().catch((error) => {
  console.error("Init DB failed:", error);
  process.exit(1);
});
