import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface ColumnRow extends RowDataPacket {
  Field: string;
}

let actionUrlReadyCache: boolean | null = null;
let loadingPromise: Promise<boolean> | null = null;

export async function getNotificationActionUrlReady() {
  if (actionUrlReadyCache !== null) return actionUrlReadyCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const [rows] = await db.execute<ColumnRow[]>("SHOW COLUMNS FROM notifications");
      const fields = new Set(rows.map((r) => r.Field));
      actionUrlReadyCache = fields.has("action_url");
      return actionUrlReadyCache;
    } catch {
      actionUrlReadyCache = false;
      return false;
    }
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}
