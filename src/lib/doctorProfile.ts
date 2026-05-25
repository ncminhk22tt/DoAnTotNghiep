import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface DoctorProfileRow extends RowDataPacket {
  id: number;
}

export async function getDoctorProfileId(userId: number): Promise<number | null> {
  const [rows] = await db.execute<DoctorProfileRow[]>(
    "SELECT id FROM doctors WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return rows.length > 0 ? rows[0].id : null;
}

