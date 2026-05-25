import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";

interface MedicalRecordDetailRow extends RowDataPacket {
  medical_record_id: number;
  appointment_id: number;
  diagnosis: string | null;
  notes: string | null;
  medical_record_created_at: string | null;
  appointment_status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  appointment_note: string | null;
  appointment_created_at: string;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  price: number | null;
  doctor_id: number | null;
  doctor_name: string | null;
  service_id: number | null;
  service_name: string | null;
}

interface PrescriptionWithItemsRow extends RowDataPacket {
  prescription_id: number;
  medical_record_id: number;
  item_id: number | null;
  medicine_name: string | null;
  dosage: string | null;
  duration: string | null;
}

interface FileRow extends RowDataPacket {
  id: number;
  medical_record_id: number;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string;
  created_at: string;
}

function parseMedicalRecordId(id: string): number | null {
  const value = Number(id);
  if (!id || Number.isNaN(value) || value <= 0) return null;
  return value;
}

// GET /api/patient/medical-records/{id}
// Bệnh nhân xem chi tiết một hồ sơ khám của chính mình.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi patient moi duoc xem lich su kham" },
        { status: 403 }
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

    const [recordRows] = await db.execute<MedicalRecordDetailRow[]>(
      `SELECT mr.id AS medical_record_id, mr.appointment_id, mr.diagnosis, mr.notes,
              mr.created_at AS medical_record_created_at,
              a.status AS appointment_status, a.note AS appointment_note, a.created_at AS appointment_created_at,
              s.work_date, s.start_time, s.end_time, s.price,
              d.id AS doctor_id, u.full_name AS doctor_name,
              s.service_id, sv.name AS service_name
       FROM medical_records mr
       JOIN appointments a ON a.id = mr.appointment_id
       LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
       LEFT JOIN doctors d ON d.id = COALESCE(a.doctor_id, s.doctor_id)
       LEFT JOIN users u ON u.id = d.user_id
       LEFT JOIN services sv ON sv.id = s.service_id
       WHERE mr.id = ? AND a.user_id = ?
       LIMIT 1`,
      [medicalRecordId, authUser.id]
    );

    if (recordRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Ho so kham benh khong ton tai" },
        { status: 404 }
      );
    }

    const [prescriptionRows] = await db.execute<PrescriptionWithItemsRow[]>(
      `SELECT p.id AS prescription_id, p.medical_record_id,
              pi.id AS item_id, pi.medicine_name, pi.dosage, pi.duration
       FROM prescriptions p
       LEFT JOIN prescription_items pi ON pi.prescription_id = p.id
       WHERE p.medical_record_id = ?
       ORDER BY p.id DESC, pi.id ASC`,
      [medicalRecordId]
    );

    const [fileRows] = await db.execute<FileRow[]>(
      `SELECT id, medical_record_id, file_name, mime_type, file_size, storage_path, created_at
       FROM medical_record_files
       WHERE medical_record_id = ?
       ORDER BY id DESC`,
      [medicalRecordId]
    );

    const prescriptions: Array<{
      id: number;
      medical_record_id: number;
      items: Array<{
        id: number;
        medicine_name: string;
        dosage: string;
        duration: string;
      }>;
    }> = [];

    for (const row of prescriptionRows) {
      let target = prescriptions.find((p) => p.id === row.prescription_id);
      if (!target) {
        target = {
          id: row.prescription_id,
          medical_record_id: row.medical_record_id,
          items: [],
        };
        prescriptions.push(target);
      }

      if (row.item_id) {
        target.items.push({
          id: row.item_id,
          medicine_name: row.medicine_name ?? "",
          dosage: row.dosage ?? "",
          duration: row.duration ?? "",
        });
      }
    }

    const row = recordRows[0];
    return NextResponse.json({
      success: true,
      message: "Lay chi tiet lich su kham thanh cong",
      data: {
        medical_record: {
          id: row.medical_record_id,
          appointment_id: row.appointment_id,
          diagnosis: row.diagnosis,
          notes: row.notes,
          created_at: row.medical_record_created_at,
        },
        appointment: {
          id: row.appointment_id,
          status: row.appointment_status,
          note: row.appointment_note,
          created_at: row.appointment_created_at,
          work_date: row.work_date,
          start_time: row.start_time,
          end_time: row.end_time,
          price: row.price,
        },
        doctor: {
          id: row.doctor_id,
          full_name: row.doctor_name,
        },
        service: {
          id: row.service_id,
          name: row.service_name,
        },
        prescriptions,
        files: fileRows,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

// DELETE /api/patient/medical-records/{id}
// Ho so benh an la du lieu y te, patient khong duoc xoa truc tiep.
export async function DELETE(
  _req: NextRequest,
  _ctx: { params: Promise<{ id: string }> }
) {
  return NextResponse.json(
    {
      success: false,
      message: "Ho so kham benh khong the xoa boi benh nhan. Vui long lien he phong kham neu can ho tro.",
    },
    { status: 405 }
  );
}
