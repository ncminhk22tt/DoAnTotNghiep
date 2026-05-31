import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";

interface MedicalRecordListRow extends RowDataPacket {
  medical_record_id: number;
  appointment_id: number;
  diagnosis: string | null;
  notes: string | null;
  medical_record_created_at: string | null;
  revision_count: number;
  appointment_status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  appointment_note: string | null;
  appointment_created_at: string;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  price: number | null;
  doctor_id: number | null;
  doctor_code: string | null;
  doctor_name: string | null;
  doctor_phone: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
  service_id: number | null;
  service_name: string | null;
  review_id: number | null;
  review_rating: number | null;
  review_comment: string | null;
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

// GET /api/patient/medical-records
// Bệnh nhân xem lịch sử khám: chẩn đoán + đơn thuốc + file đính kèm.
export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi patient moi duoc xem lich su kham" },
        { status: 403 }
      );
    }

    const [recordRows] = await db.execute<MedicalRecordListRow[]>(
      `SELECT mr.id AS medical_record_id, mr.appointment_id, mr.diagnosis, mr.notes,
              mr.created_at AS medical_record_created_at,
              COALESCE(mrr.revision_count, 0) AS revision_count,
              a.status AS appointment_status, a.note AS appointment_note, a.created_at AS appointment_created_at,
              s.work_date, s.start_time, s.end_time, s.room, s.price,
              d.id AS doctor_id, d.doctor_code AS doctor_code, u.full_name AS doctor_name, u.phone AS doctor_phone,
              sp.id AS specialty_id, sp.name AS specialty_name,
              s.service_id, sv.name AS service_name,
              dr.id AS review_id, dr.rating AS review_rating, dr.comment AS review_comment
       FROM medical_records mr
       JOIN appointments a ON a.id = mr.appointment_id
       LEFT JOIN (
         SELECT medical_record_id, COUNT(*) AS revision_count
         FROM medical_record_revisions
         GROUP BY medical_record_id
       ) mrr ON mrr.medical_record_id = mr.id
       LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
       LEFT JOIN doctors d ON d.id = COALESCE(a.doctor_id, s.doctor_id)
       LEFT JOIN users u ON u.id = d.user_id
       LEFT JOIN services sv ON sv.id = s.service_id
       LEFT JOIN specialties sp ON sp.id = COALESCE(sv.specialty_id, d.specialty_id)
       LEFT JOIN doctor_reviews dr ON dr.appointment_id = a.id AND dr.user_id = a.user_id
       WHERE a.user_id = ?
       ORDER BY COALESCE(s.work_date, DATE(a.created_at)) DESC, mr.id DESC`,
      [authUser.id]
    );

    if (recordRows.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Chua co lich su kham",
        data: [],
      });
    }

    const medicalRecordIds = recordRows.map((row) => row.medical_record_id);
    const placeholders = medicalRecordIds.map(() => "?").join(",");

    const [prescriptionRows] = await db.execute<PrescriptionWithItemsRow[]>(
      `SELECT p.id AS prescription_id, p.medical_record_id,
              pi.id AS item_id, pi.medicine_name, pi.dosage, pi.duration
       FROM prescriptions p
       LEFT JOIN prescription_items pi ON pi.prescription_id = p.id
       WHERE p.medical_record_id IN (${placeholders})
       ORDER BY p.id DESC, pi.id ASC`,
      medicalRecordIds
    );

    const [fileRows] = await db.execute<FileRow[]>(
      `SELECT id, medical_record_id, file_name, mime_type, file_size, storage_path, created_at
       FROM medical_record_files
       WHERE medical_record_id IN (${placeholders})
       ORDER BY id DESC`,
      medicalRecordIds
    );

    const prescriptionMap = new Map<
      number,
      Array<{
        id: number;
        medical_record_id: number;
        items: Array<{
          id: number;
          medicine_name: string;
          dosage: string;
          duration: string;
        }>;
      }>
    >();

    for (const row of prescriptionRows) {
      const currentByRecord = prescriptionMap.get(row.medical_record_id) ?? [];
      const found = currentByRecord.find((p) => p.id === row.prescription_id);
      if (!found) {
        currentByRecord.push({
          id: row.prescription_id,
          medical_record_id: row.medical_record_id,
          items: [],
        });
      }

      const target =
        currentByRecord.find((p) => p.id === row.prescription_id) ??
        currentByRecord[currentByRecord.length - 1];

      if (row.item_id) {
        target.items.push({
          id: row.item_id,
          medicine_name: row.medicine_name ?? "",
          dosage: row.dosage ?? "",
          duration: row.duration ?? "",
        });
      }

      prescriptionMap.set(row.medical_record_id, currentByRecord);
    }

    const fileMap = new Map<number, FileRow[]>();
    for (const row of fileRows) {
      const current = fileMap.get(row.medical_record_id) ?? [];
      current.push(row);
      fileMap.set(row.medical_record_id, current);
    }

    const data = recordRows.map((row) => ({
      medical_record: {
        id: row.medical_record_id,
        appointment_id: row.appointment_id,
        diagnosis: row.diagnosis,
        notes: row.notes,
        created_at: row.medical_record_created_at,
        doctor_revision_count: Number(row.revision_count || 0),
      },
      appointment: {
        id: row.appointment_id,
        status: row.appointment_status,
        note: row.appointment_note,
        created_at: row.appointment_created_at,
        work_date: row.work_date,
        start_time: row.start_time,
        end_time: row.end_time,
        room: row.room,
        price: row.price,
      },
      doctor: {
        id: row.doctor_id,
        code: row.doctor_code,
        full_name: row.doctor_name,
        phone: row.doctor_phone,
      },
      specialty: {
        id: row.specialty_id,
        name: row.specialty_name,
      },
      service: {
        id: row.service_id,
        name: row.service_name,
      },
      review: {
        id: row.review_id,
        rating: row.review_rating,
        comment: row.review_comment,
      },
      prescriptions: prescriptionMap.get(row.medical_record_id) ?? [],
      files: fileMap.get(row.medical_record_id) ?? [],
    }));

    return NextResponse.json({
      success: true,
      message: "Lay lich su kham thanh cong",
      data,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}
