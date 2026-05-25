import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface ColumnRow extends RowDataPacket {
  Field: string;
}

let readyCache: boolean | null = null;
let loadingPromise: Promise<boolean> | null = null;

export async function getAppointmentWorkflowSchemaReady() {
  if (readyCache !== null) return readyCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const [rows] = await db.execute<ColumnRow[]>("SHOW COLUMNS FROM appointments");
    const fields = new Set(rows.map((row) => row.Field));
    const missingColumns: string[] = [];

    if (!fields.has("checked_in_at")) missingColumns.push("checked_in_at");
    if (!fields.has("checked_in_by")) missingColumns.push("checked_in_by");

    const [waitlistTables] = await db.query<RowDataPacket[]>("SHOW TABLES LIKE 'appointment_waitlist'");
    const hasWaitlistTable = waitlistTables.length > 0;

    if (missingColumns.length > 0 || !hasWaitlistTable) {
      const missingParts = [
        missingColumns.length > 0 ? `columns: ${missingColumns.join(", ")}` : null,
        !hasWaitlistTable ? "table: appointment_waitlist" : null,
      ]
        .filter(Boolean)
        .join("; ");
      throw new Error(`Database schema not ready for appointment workflow (${missingParts})`);
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
