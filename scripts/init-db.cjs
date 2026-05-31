const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { getLocalDbConfig } = require("./db-local.cjs");

async function main() {
  const db = getLocalDbConfig();

  const sqlPath = path.join(process.cwd(), "database", "init.sql");
  let initSql = fs.readFileSync(sqlPath, "utf8");
  if (initSql.charCodeAt(0) === 0xfeff) {
    initSql = initSql.slice(1);
  }

  const conn = await mysql.createConnection({
    host: db.host,
    user: db.user,
    password: db.password,
    port: db.port,
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
