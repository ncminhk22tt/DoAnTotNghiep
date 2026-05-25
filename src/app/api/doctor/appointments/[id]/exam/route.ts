// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";

type CreateExamBody = {
  diagnosis?: unknown;
  notes?: unknown;
};

interface AppointmentRow extends RowDataPacket {
  id: number;
  user_id: number;
  slot_id: number | null;
  doctor_id: number | null;
  status: "pending" | "confirmed" | "completed" | "cancelled";
}

interface MedicalRecordExistsRow extends RowDataPacket {
  id: number;
}

function parseAppointmentId(id: string): number | null {
  const appointmentId = Number(id);
  if (!id || Number.isNaN(appointmentId) || appointmentId <= 0) return null;
  return appointmentId;
}

// POST /api/doctor/appointments/{id}/exam
// Luu ket qua kham va danh dau lịch hẹn da hoan tat
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();

  try {
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

    const { id } = await params;
    const appointmentId = parseAppointmentId(id);
    if (!appointmentId) {
      return NextResponse.json(
        { success: false, message: "appointment_id khong hop le" },
        { status: 400 }
      );
    }

    let body: CreateExamBody;
    try {
      body = (await req.json()) as CreateExamBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const diagnosis = typeof body.diagnosis === "string" ? body.diagnosis.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    if (!diagnosis) {
      return NextResponse.json(
        { success: false, message: "Chan doan khong duoc de trong" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [appointmentRows] = await connection.execute<AppointmentRow[]>(
      `SELECT a.id, a.user_id, a.slot_id, a.doctor_id, a.status
       FROM appointments a
       LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
       WHERE a.id = ?
         AND COALESCE(a.doctor_id, s.doctor_id) = ?
       FOR UPDATE`,
      [appointmentId, doctorProfileId]
    );

    if (appointmentRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen khong ton tai" },
        { status: 404 }
      );
    }

    const appointment = appointmentRows[0];

    if (!["pending", "confirmed", "completed"].includes(appointment.status)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Khong the luu ket qua cho lich da huy" },
        { status: 400 }
      );
    }

    const [existsRows] = await connection.execute<MedicalRecordExistsRow[]>(
      "SELECT id FROM medical_records WHERE appointment_id = ? LIMIT 1",
      [appointmentId]
    );

    if (existsRows.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen nay da co ket qua kham" },
        { status: 409 }
      );
    }

    const [recordResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO medical_records (appointment_id, diagnosis, notes, created_at)
       VALUES (?, ?, ?, NOW())`,
      [appointmentId, diagnosis, notes]
    );

    await connection.execute<ResultSetHeader>(
      `UPDATE appointments
       SET status = 'completed'
       WHERE id = ?`,
      [appointmentId]
    );

    const actionUrlReady = await getNotificationActionUrlReady();
    const completedMessage = "Ban da kham xong. Vui long thanh toan phi kham (hien tai: chua thanh toan).";
    if (actionUrlReady) {
      await connection.execute(
        `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
         VALUES (?, ?, ?, false, NOW())`,
        [appointment.user_id, completedMessage, "/patient/appointments"]
      );
    } else {
      await connection.execute(
        `INSERT INTO notifications (user_id, message, is_read, created_at)
         VALUES (?, ?, false, NOW())`,
        [appointment.user_id, completedMessage]
      );
    }

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Luu ket qua kham thanh cong",
      data: {
        appointment_id: appointmentId,
        medical_record_id: recordResult.insertId,
      },
    });
  } catch {
    await connection.rollback();
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
