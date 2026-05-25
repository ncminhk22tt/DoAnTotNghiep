import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";

let readyCache: boolean | null = null;
let loadingPromise: Promise<boolean> | null = null;

export async function ensureAuditLogTable() {
  if (readyCache !== null) return readyCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const [tables] = await db.query<RowDataPacket[]>("SHOW TABLES LIKE 'audit_logs'");
    readyCache = tables.length > 0;
    if (!readyCache) {
      throw new Error("Database schema not ready: missing audit_logs table");
    }
    return readyCache;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

