import { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";

interface StatusColumnRow extends RowDataPacket {
  COLUMN_TYPE: string;
}

let checked = false;
let checkingPromise: Promise<void> | null = null;

// Validate schema only. Runtime requests must not mutate DB structure.
export async function ensureScheduleClosedStatus() {
  if (checked) return;
  if (checkingPromise) {
    await checkingPromise;
    return;
  }

  checkingPromise = (async () => {
    const [rows] = await db.execute<StatusColumnRow[]>(
      `SELECT COLUMN_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'doctor_schedule_slots'
         AND COLUMN_NAME = 'status'
       LIMIT 1`
    );

    if (rows.length === 0) {
      throw new Error("Database schema not ready: missing doctor_schedule_slots.status");
    }

    const columnType = rows[0].COLUMN_TYPE || "";
    if (!columnType.includes("'closed'") || !columnType.includes("'locked'")) {
      throw new Error("Database schema not ready: doctor_schedule_slots.status must include 'closed' and 'locked'");
    }

    checked = true;
  })();

  try {
    await checkingPromise;
  } finally {
    checkingPromise = null;
  }
}
