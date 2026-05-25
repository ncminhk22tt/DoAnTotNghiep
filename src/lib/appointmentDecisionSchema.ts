import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface ColumnRow extends RowDataPacket {
  Field: string;
  Type: string;
}

let readyCache: boolean | null = null;
let loadingPromise: Promise<boolean> | null = null;

export async function getAppointmentDecisionSchemaReady() {
  if (readyCache !== null) return readyCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const [rows] = await db.execute<ColumnRow[]>("SHOW COLUMNS FROM appointments");
    const fields = new Set(rows.map((row) => row.Field));
    const statusColumn = rows.find((row) => row.Field === "status");

    if (!fields.has("admin_note")) {
      throw new Error("Database schema not ready: missing appointments.admin_note");
    }

    if (!statusColumn || !statusColumn.Type.includes("'no_show'")) {
      throw new Error("Database schema not ready: appointments.status must include 'no_show'");
    }

    readyCache = true;
    return true;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}
