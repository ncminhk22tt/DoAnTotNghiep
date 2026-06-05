// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có transaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db, hasTableColumn } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";

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
// Xem danh sách lịch hẹn của bác sĩ hiện tại
export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "doctor") {
      return NextResponse.json(
        { success: false, message: "Không đúng quyền bác sĩ" },
        { status: 403 }
      );
    }

    const doctorProfileId = await getDoctorProfileId(authUser.id);
    if (!doctorProfileId) {
      return NextResponse.json(
        { success: false, message: "Hồ sơ bác sĩ không tồn tại" },
        { status: 404 }
      );
    }

    const status = req.nextUrl.searchParams.get("status");
    const date = req.nextUrl.searchParams.get("date");
    const serviceIdParam = req.nextUrl.searchParams.get("service_id");
    const serviceId = serviceIdParam ? Number(serviceIdParam) : Number.NaN;
    const hasAdminNoteColumn = await hasTableColumn("appointments", "admin_note");

    let sql = `SELECT a.id, a.user_id, a.slot_id, a.doctor_id, a.status, a.note, ${hasAdminNoteColumn ? "a.admin_note" : "NULL AS admin_note"}, a.created_at,
                      p.full_name AS patient_name, p.phone AS patient_phone,
                      DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
                      TIME_FORMAT(s.start_time, '%H:%i:%s') AS start_time,
                      TIME_FORMAT(s.end_time, '%H:%i:%s') AS end_time,
                      s.room, s.service_id,
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

    if (Number.isInteger(serviceId) && serviceId > 0) {
      sql += " AND s.service_id = ?";
      params.push(serviceId);
    }

    sql += " ORDER BY a.created_at DESC, a.id DESC";

    const [rows] = await db.execute<DoctorAppointmentListRow[]>(sql, params);

    return NextResponse.json({
      success: true,
      message: "Lấy danh sách lịch hẹn thành công",
      data: rows,
    });
  } catch (error) {
    console.error("GET /api/doctor/appointments failed:", error);
    return NextResponse.json({ success: false, message: "Lỗi server" }, { status: 500 });
  }
}
