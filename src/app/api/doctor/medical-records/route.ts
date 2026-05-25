// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";

interface MedicalRecordRow extends RowDataPacket {
  id: number;
  appointment_id: number;
  diagnosis: string | null;
  notes: string | null;
  created_at: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  patient_email: string | null;
  appointment_note: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  service_name: string | null;
  status: string | null;
}

// GET /api/doctor/medical-records
export async function GET(req: NextRequest) {
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

    const appointmentIdParam = req.nextUrl.searchParams.get("appointment_id");

    let sql = `SELECT mr.id, mr.appointment_id, mr.diagnosis, mr.notes, mr.created_at,
                      u.full_name AS patient_name, u.phone AS patient_phone, u.email AS patient_email,
                      a.note AS appointment_note,
                      s.work_date, s.start_time, s.end_time, s.room, sv.name AS service_name,
                      a.status
               FROM medical_records mr
               JOIN appointments a ON a.id = mr.appointment_id
               LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
               LEFT JOIN users u ON u.id = a.user_id
               LEFT JOIN services sv ON sv.id = s.service_id
               WHERE COALESCE(a.doctor_id, s.doctor_id) = ?`;
    const params: Array<string | number> = [doctorId];

    if (appointmentIdParam) {
      const appointmentId = Number(appointmentIdParam);
      if (Number.isNaN(appointmentId) || appointmentId <= 0) {
        return NextResponse.json(
          { success: false, message: "appointment_id khong hop le" },
          { status: 400 }
        );
      }
      sql += " AND mr.appointment_id = ?";
      params.push(appointmentId);
    }

    sql += " ORDER BY mr.id DESC";

    const [rows] = await db.execute<MedicalRecordRow[]>(sql, params);

    return NextResponse.json({
      success: true,
      message: "Lay danh sach ho so kham benh thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

