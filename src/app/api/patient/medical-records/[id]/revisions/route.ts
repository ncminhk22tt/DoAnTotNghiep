import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";

interface MedicalRecordOwnerRow extends RowDataPacket {
  id: number;
}

interface RevisionRow extends RowDataPacket {
  id: number;
  diagnosis: string | null;
  notes: string | null;
  prescription_json: string | null;
  created_at: string;
}

function parseId(raw: string) {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi patient moi duoc xem lich su sua" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const medicalRecordId = parseId(id);
    if (!medicalRecordId) {
      return NextResponse.json(
        { success: false, message: "medical_record_id khong hop le" },
        { status: 400 }
      );
    }

    const [ownerRows] = await db.execute<MedicalRecordOwnerRow[]>(
      `SELECT mr.id
       FROM medical_records mr
       JOIN appointments a ON a.id = mr.appointment_id
       WHERE mr.id = ? AND a.user_id = ?
       LIMIT 1`,
      [medicalRecordId, authUser.id]
    );

    if (ownerRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Ho so khong ton tai" },
        { status: 404 }
      );
    }

    const [rows] = await db.execute<RevisionRow[]>(
      `SELECT id, diagnosis, notes, prescription_json, created_at
       FROM medical_record_revisions
       WHERE medical_record_id = ?
       ORDER BY id DESC`,
      [medicalRecordId]
    );

    const data = rows.map((row) => {
      let prescription_items: Array<{ medicine_name: string; dosage: string; duration: string }> = [];
      if (row.prescription_json) {
        try {
          const parsed = JSON.parse(row.prescription_json);
          if (Array.isArray(parsed)) {
            prescription_items = parsed
              .map((x) => ({
                medicine_name: typeof x?.medicine_name === "string" ? x.medicine_name : "",
                dosage: typeof x?.dosage === "string" ? x.dosage : "",
                duration: typeof x?.duration === "string" ? x.duration : "",
              }))
              .filter((x) => x.medicine_name || x.dosage || x.duration);
          }
        } catch {
          prescription_items = [];
        }
      }

      return {
        id: row.id,
        diagnosis: row.diagnosis,
        notes: row.notes,
        created_at: row.created_at,
        prescription_items,
      };
    });

    return NextResponse.json({
      success: true,
      message: "Lay lich su sua thanh cong",
      data,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}
