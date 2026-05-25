import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface ColumnCheckRow extends RowDataPacket {
  column_name: string;
}

let isReadyCache: boolean | null = null;

async function hasServiceSoftDeleteColumns() {
  if (isReadyCache !== null) return isReadyCache;

  let rows: ColumnCheckRow[] = [];
  try {
    const [queryRows] = await db.execute<ColumnCheckRow[]>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'services'
         AND column_name IN ('is_active', 'deleted_at')`
    );
    rows = queryRows;
  } catch {
    isReadyCache = false;
    return isReadyCache;
  }

  isReadyCache =
    rows.some((x) => x.column_name === "is_active") &&
    rows.some((x) => x.column_name === "deleted_at");

  return isReadyCache;
}

// Validate schema only. Schema migration must be done before runtime.
export async function getServiceSoftDeleteReady() {
  return hasServiceSoftDeleteColumns();
}
