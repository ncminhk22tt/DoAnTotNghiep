import mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2";

const rawHost = process.env.DB_HOST?.trim();
const host = rawHost === "localhost" ? "127.0.0.1" : rawHost || "127.0.0.1";
const parsedPort = Number(process.env.DB_PORT);
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3306;

export const db = mysql.createPool({
  host,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10_000,
});

const tableColumnsCache = new Map<string, Promise<Set<string>>>();

export async function hasTableColumn(table: string, column: string): Promise<boolean> {
  const key = table.toLowerCase();
  let cached = tableColumnsCache.get(key);
  if (!cached) {
    cached = (async () => {
      const [rows] = await db.execute<RowDataPacket[]>(
        'SHOW COLUMNS FROM `' + table + '`'
      );
      return new Set(rows.map((row) => String(row.Field).toLowerCase()));
    })();
    tableColumnsCache.set(key, cached);
  }

  const columns = await cached;
  return columns.has(column.toLowerCase());
}
