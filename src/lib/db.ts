import mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2";

const host = process.env.DB_HOST || "127.0.0.1";
const parsedPort = Number(process.env.DB_PORT);
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3306;
const user = process.env.DB_USER || "root";
const password = process.env.DB_PASSWORD || "";
const database = process.env.DB_NAME || "medical_booking";

export const db = mysql.createPool({
  host,
  user,
  password,
  database,
  port,
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10_000,
});

export const dbConfig = {
  host,
  port,
  user,
  password,
  database,
};

const tableColumnsCache = new Map<string, Promise<Set<string>>>();
const tableExistsCache = new Map<string, Promise<boolean>>();

export async function hasTableColumn(table: string, column: string): Promise<boolean> {
  const key = table.toLowerCase();
  let cached = tableColumnsCache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          "SHOW COLUMNS FROM `" + table + "`"
        );
        return new Set(rows.map((row) => String(row.Field).toLowerCase()));
      } catch {
        return new Set<string>();
      }
    })();
    tableColumnsCache.set(key, cached);
  }

  const columns = await cached;
  return columns.has(column.toLowerCase());
}

export async function hasTable(table: string): Promise<boolean> {
  const key = table.toLowerCase();
  let cached = tableExistsCache.get(key);
  if (!cached) {
    cached = (async () => {
      try {
        const [rows] = await db.query<RowDataPacket[]>("SHOW TABLES LIKE ?", [table]);
        return rows.length > 0;
      } catch {
        return false;
      }
    })();
    tableExistsCache.set(key, cached);
  }

  return cached;
}
