// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";
import { getAppointmentDecisionSchemaReady } from "@/lib/appointmentDecisionSchema";

interface DoctorAppointmentListRow extends RowDataPacket {
  id: number;
  user_id: number;
  slot_id: number | null;
  doctor_id: number | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  note: string | null;
  admin_note: string | null;
  created_at: string;
  patient_name: string | null;
  patient_phone: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  service_id: number | null;
  service_name: string | null;
}

// GET /api/doctor/appointments
// Xem danh sach lịch hẹn cua doctor hien tai
export async function GET(req: NextRequest) {
  try {
    await getAppointmentDecisionSchemaReady();
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "doctor") {
      return NextResponse.json(
        { success: false, message: "Khong dung quyen doctor" },
        { status: 403 }
      );
    }

    const doctorProfileId = await getDoctorProfileId(authUser.id);
    if (!doctorProfileId) {
      return NextResponse.json(
        { success: false, message: "Doctor profile khong ton tai" },
        { status: 404 }
      );
    }

    const status = req.nextUrl.searchParams.get("status");
    const date = req.nextUrl.searchParams.get("date");

    let sql = `SELECT a.id, a.user_id, a.slot_id, a.doctor_id, a.status, a.note, a.admin_note, a.created_at,
                      p.full_name AS patient_name, p.phone AS patient_phone,
                      s.work_date, s.start_time, s.end_time, s.room, s.service_id,
                      sv.name AS service_name
               FROM appointments a
               JOIN users p ON p.id = a.user_id
               LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
               LEFT JOIN services sv ON sv.id = s.service_id
               WHERE COALESCE(a.doctor_id, s.doctor_id) = ?`;
    const params: Array<string | number> = [doctorProfileId];

    if (status === "pending_confirmed") {
      sql += " AND a.status IN ('pending', 'confirmed')";
    } else if (status && ["pending", "confirmed", "completed", "cancelled", "no_show"].includes(status)) {
      sql += " AND a.status = ?";
      params.push(status);
    }

    if (date) {
      sql += " AND s.work_date = ?";
      params.push(date);
    }

    sql += " ORDER BY a.created_at DESC, a.id DESC";

    const [rows] = await db.execute<DoctorAppointmentListRow[]>(sql, params);

    return NextResponse.json({
      success: true,
      message: "Lay danh sach lich hen thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

