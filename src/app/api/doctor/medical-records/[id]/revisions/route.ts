import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";

interface MedicalRecordRow extends RowDataPacket {
  id: number;
}

interface MedicalRecordRevisionRow extends RowDataPacket {
  id: number;
  diagnosis: string | null;
  notes: string | null;
  prescription_json: string | null;
  created_at: string;
}

function parseMedicalRecordId(id: string): number | null {
  const medicalRecordId = Number(id);
  if (!id || Number.isNaN(medicalRecordId) || medicalRecordId <= 0) return null;
  return medicalRecordId;
}

async function ensureMedicalRecordOwnedByDoctor(medicalRecordId: number, doctorId: number) {
  const [rows] = await db.execute<MedicalRecordRow[]>(
    `SELECT mr.id
     FROM medical_records mr
     JOIN appointments a ON a.id = mr.appointment_id
     LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
     WHERE mr.id = ?
       AND COALESCE(a.doctor_id, s.doctor_id) = ?
     LIMIT 1`,
    [medicalRecordId, doctorId]
  );
  return rows.length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "doctor") {
      return NextResponse.json(
        { success: false, message: "Khong dung quyen doctor" },
        { status: 403 }
      );
    }

    const doctorId = await getDoctorProfileId(authUser.id);
    if (!doctorId) {
      return NextResponse.json(
        { success: false, message: "Doctor profile khong ton tai" },
        { status: 404 }
      );
    }

    const { id } = await params;
    const medicalRecordId = parseMedicalRecordId(id);
    if (!medicalRecordId) {
      return NextResponse.json(
        { success: false, message: "medical_record_id khong hop le" },
        { status: 400 }
      );
    }

    const owned = await ensureMedicalRecordOwnedByDoctor(medicalRecordId, doctorId);
    if (!owned) {
      return NextResponse.json(
        { success: false, message: "Ho so kham benh khong ton tai" },
        { status: 404 }
      );
    }

    const [rows] = await db.execute<MedicalRecordRevisionRow[]>(
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
              .map((item) => ({
                medicine_name: typeof item?.medicine_name === "string" ? item.medicine_name : "",
                dosage: typeof item?.dosage === "string" ? item.dosage : "",
                duration: typeof item?.duration === "string" ? item.duration : "",
              }))
              .filter((item) => item.medicine_name || item.dosage || item.duration);
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
      message: "Lay lich su ket qua kham thanh cong",
      data,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}
