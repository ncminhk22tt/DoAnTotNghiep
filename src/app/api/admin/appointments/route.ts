// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db, hasTableColumn } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getAppointmentDecisionSchemaReady } from "@/lib/appointmentDecisionSchema";
import { getAppointmentWorkflowSchemaReady } from "@/lib/appointmentWorkflowSchema";
import { getAuthUserFromRequest } from "@/lib/requestAuth";

interface AdminAppointmentRow extends RowDataPacket {
  id: number;
  user_id: number;
  slot_id: number | null;
  doctor_id: number | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  payment_status: "unpaid" | "paid";
  note: string | null;
  admin_note: string | null;
  checked_in_at: string | null;
  checked_in_by: number | null;
  created_at: string;
  patient_name: string | null;
  patient_phone: string | null;
  patient_gender: string | null;
  patient_birth_year: number | null;
  doctor_name: string | null;
  doctor_code: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  service_name: string | null;
  service_id: number | null;
  price: number | null;
  paid_at: string | null;
  payment_amount: number | null;
  completed_at?: string | null;
  cancelled_by_name?: string | null;
  cancelled_by_role?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  no_show_at?: string | null;
}

// GET /api/admin/appointments?status=pending&date=2026-03-29
export async function GET(req: NextRequest) {
  try {
    await getAppointmentWorkflowSchemaReady();
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "admin") {
      return NextResponse.json(
        { success: false, message: "Chi admin moi duoc xem lich hen" },
        { status: 403 }
      );
    }
    const decisionReady = await getAppointmentDecisionSchemaReady();
    const status = req.nextUrl.searchParams.get("status");
    const date = req.nextUrl.searchParams.get("date");
    const doctorIdParam = req.nextUrl.searchParams.get("doctor_id");
    const patientIdParam = req.nextUrl.searchParams.get("patient_id");

    const paymentStatusReady = await hasTableColumn("appointments", "payment_status");
    const paidAtReady = await hasTableColumn("appointments", "paid_at");
    const userGenderReady = await hasTableColumn("users", "gender");
    const userBirthYearReady = await hasTableColumn("users", "birth_year");
    const userYearOfBirthReady = userBirthYearReady ? false : await hasTableColumn("users", "year_of_birth");
    const userDateOfBirthReady =
      userBirthYearReady || userYearOfBirthReady ? false : await hasTableColumn("users", "date_of_birth");
    const slotRoomReady = await hasTableColumn("doctor_schedule_slots", "room");
    const paymentStatusSelect = paymentStatusReady ? "a.payment_status" : "'unpaid' AS payment_status";
    const paidAtSelect = paidAtReady ? "a.paid_at" : "NULL AS paid_at";
    const patientGenderSelect = userGenderReady ? "p.gender" : "NULL";
    const patientBirthYearSelect = userBirthYearReady
      ? "p.birth_year"
      : userYearOfBirthReady
      ? "p.year_of_birth"
      : userDateOfBirthReady
      ? "YEAR(p.date_of_birth)"
      : "NULL";
    const roomSelect = slotRoomReady ? "s.room" : "NULL";
    const requestedPaymentStatus = req.nextUrl.searchParams.get("payment_status");

    if (requestedPaymentStatus && !["unpaid", "paid"].includes(requestedPaymentStatus)) {
      return NextResponse.json(
        { success: false, message: "payment_status khong hop le" },
        { status: 400 }
      );
    }

    let sql = `SELECT a.id, a.user_id, a.slot_id, COALESCE(a.doctor_id, s.doctor_id) AS doctor_id, a.status, ${paymentStatusSelect}, ${paidAtSelect}, a.note, ${decisionReady ? "a.admin_note" : "NULL AS admin_note"}, a.checked_in_at, a.checked_in_by, a.created_at,
                      p.full_name AS patient_name, p.phone AS patient_phone, ${patientGenderSelect} AS patient_gender, ${patientBirthYearSelect} AS patient_birth_year, du.full_name AS doctor_name, d.doctor_code,
                      s.work_date, s.start_time, s.end_time, ${roomSelect} AS room, sv.name AS service_name, s.service_id, s.price,
                      ${paidAtSelect} AS paid_at,
                      (SELECT pmt.amount
                       FROM payments pmt
                       WHERE pmt.appointment_id = a.id
                         AND pmt.status = 'completed'
                       ORDER BY pmt.id DESC
                       LIMIT 1) AS payment_amount,
                      (SELECT u2.full_name
                       FROM audit_logs al2
                       LEFT JOIN users u2 ON u2.id = al2.user_id
                       WHERE al2.entity_type = 'appointment'
                         AND al2.entity_id = a.id
                         AND al2.status = 'success'
                         AND al2.detail LIKE '%-> cancelled%'
                       ORDER BY al2.id DESC
                       LIMIT 1) AS cancelled_by_name,
                      (SELECT u2.role
                       FROM audit_logs al2
                       LEFT JOIN users u2 ON u2.id = al2.user_id
                       WHERE al2.entity_type = 'appointment'
                         AND al2.entity_id = a.id
                         AND al2.status = 'success'
                         AND al2.detail LIKE '%-> cancelled%'
                       ORDER BY al2.id DESC
                       LIMIT 1) AS cancelled_by_role,
                      (SELECT al2.created_at
                       FROM audit_logs al2
                       WHERE al2.entity_type = 'appointment'
                         AND al2.entity_id = a.id
                         AND al2.status = 'success'
                         AND al2.detail LIKE '%-> cancelled%'
                       ORDER BY al2.id DESC
                       LIMIT 1) AS cancelled_at,
                      (SELECT al2.created_at
                       FROM audit_logs al2
                       WHERE al2.entity_type = 'appointment'
                         AND al2.entity_id = a.id
                         AND al2.status = 'success'
                         AND al2.detail LIKE '%-> no_show%'
                       ORDER BY al2.id DESC
                       LIMIT 1) AS no_show_at,
                      a.admin_note AS cancellation_reason,
                      mr.created_at AS completed_at
               FROM appointments a
               LEFT JOIN users p ON p.id = a.user_id
               LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
               LEFT JOIN medical_records mr ON mr.appointment_id = a.id
               LEFT JOIN doctors d ON d.id = COALESCE(a.doctor_id, s.doctor_id)
               LEFT JOIN users du ON du.id = d.user_id
               LEFT JOIN services sv ON sv.id = s.service_id
               WHERE 1 = 1`;
    const params: Array<string | number> = [];

    if (status && ["pending", "confirmed", "completed", "cancelled", "no_show"].includes(status)) {
      sql += " AND a.status = ?";
      params.push(status);
    }

    if (date) {
      sql += " AND s.work_date = ?";
      params.push(date);
    }

    if (requestedPaymentStatus && paymentStatusReady && ["unpaid", "paid"].includes(requestedPaymentStatus)) {
      sql += " AND a.payment_status = ?";
      params.push(requestedPaymentStatus);
    }

    const serviceIdParam = req.nextUrl.searchParams.get("service_id");
    if (serviceIdParam) {
      const serviceId = Number(serviceIdParam);
      if (Number.isNaN(serviceId) || serviceId <= 0) {
        return NextResponse.json(
          { success: false, message: "service_id khong hop le" },
          { status: 400 }
        );
      }
      sql += " AND s.service_id = ?";
      params.push(serviceId);
    }

    const doctorQuery = req.nextUrl.searchParams.get("doctor_query");
    if (doctorQuery) {
      sql += " AND (du.full_name LIKE ? OR d.doctor_code LIKE ?)";
      params.push(`%${doctorQuery}%`, `%${doctorQuery}%`);
    }

    if (doctorIdParam) {
      const doctorId = Number(doctorIdParam);
      if (Number.isNaN(doctorId) || doctorId <= 0) {
        return NextResponse.json(
          { success: false, message: "doctor_id khong hop le" },
          { status: 400 }
        );
      }
      sql += " AND COALESCE(a.doctor_id, s.doctor_id) = ?";
      params.push(doctorId);
    }

    if (patientIdParam) {
      const patientId = Number(patientIdParam);
      if (Number.isNaN(patientId) || patientId <= 0) {
        return NextResponse.json(
          { success: false, message: "patient_id khong hop le" },
          { status: 400 }
        );
      }
      sql += " AND a.user_id = ?";
      params.push(patientId);
    }

    sql += " ORDER BY a.created_at DESC, a.id DESC";

    const [rows] = await db.execute<AdminAppointmentRow[]>(sql, params);

    return NextResponse.json({
      success: true,
      message: "Lay danh sach lich hen thanh cong",
      data: rows,
    });
  } catch (error) {
    console.error("GET /api/admin/appointments failed:", error);
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}


