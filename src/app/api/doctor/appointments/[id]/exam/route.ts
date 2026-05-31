// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có transaction: nhớ beginTransaction/commit/rollback.

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
  work_date?: string | null;
  start_time?: string | null;
}

interface MedicalRecordExistsRow extends RowDataPacket {
  id: number;
}

function parseAppointmentId(id: string): number | null {
  const appointmentId = Number(id);
  if (!id || Number.isNaN(appointmentId) || appointmentId <= 0) return null;
  return appointmentId;
}

type ClinicDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getClinicDateTimeParts(date = new Date()): ClinicDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  type DateTimePartType = Intl.DateTimeFormatPart["type"];
  const get = (type: DateTimePartType) => Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function toClinicDateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(parsed);
    }
    return value.slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function toClinicTimeString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(value);
  }
  if (typeof value === "string") return value.slice(0, 5);
  return String(value).slice(0, 5);
}

function compareClinicDateTime(dateValue: unknown, timeValue: unknown) {
  const normalizedDate = toClinicDateString(dateValue);
  const normalizedTime = toClinicTimeString(timeValue);
  if (!normalizedDate || !normalizedTime) return Number.NaN;
  const [year, month, day] = normalizedDate.split("-").map((value) => Number(value));
  const [hour, minute] = normalizedTime.split(":").map((value) => Number(value));
  if ([year, month, day, hour, minute].some((value) => !Number.isFinite(value))) return Number.NaN;
  return ((year * 100 + month) * 100 + day) * 10000 + hour * 100 + minute;
}

function isAppointmentStartReached(workDate: string | null, startTime: string | null) {
  const appointmentTime = compareClinicDateTime(workDate, startTime);
  if (!Number.isFinite(appointmentTime)) return false;
  const now = getClinicDateTimeParts();
  const currentTime = ((now.year * 100 + now.month) * 100 + now.day) * 10000 + now.hour * 100 + now.minute;
  return appointmentTime <= currentTime;
}

// POST /api/doctor/appointments/{id}/exam
// Lưu kết quả khám và đánh dấu lịch hẹn đã hoàn tất
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();

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

    const { id } = await params;
    const appointmentId = parseAppointmentId(id);
    if (!appointmentId) {
      return NextResponse.json(
        { success: false, message: "appointment_id không hợp lệ" },
        { status: 400 }
      );
    }

    let body: CreateExamBody;
    try {
      body = (await req.json()) as CreateExamBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON không hợp lệ" },
        { status: 400 }
      );
    }

    const diagnosis = typeof body.diagnosis === "string" ? body.diagnosis.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    if (!diagnosis) {
      return NextResponse.json(
        { success: false, message: "Chẩn đoán không được để trống" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [appointmentRows] = await connection.execute<AppointmentRow[]>(
      `SELECT a.id, a.user_id, a.slot_id, a.doctor_id, a.status,
              DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
              s.start_time
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
        { success: false, message: "Lịch hẹn không tồn tại" },
        { status: 404 }
      );
    }

    const appointment = appointmentRows[0];

    if (!["pending", "confirmed", "completed"].includes(appointment.status)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Không thể lưu kết quả cho lịch đã hủy" },
        { status: 400 }
      );
    }

    if (!isAppointmentStartReached(appointment.work_date || null, appointment.start_time || null)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chỉ được khám bệnh từ giờ bắt đầu lịch khám trở đi." },
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
        { success: false, message: "Lịch hẹn này đã có kết quả khám" },
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
    const completedMessage = "Bạn đã khám xong. Vui lòng thanh toán phí khám (hiện tại: chưa thanh toán).";
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
      message: "Lưu kết quả khám thành công",
      data: {
        appointment_id: appointmentId,
        medical_record_id: recordResult.insertId,
      },
    });
  } catch (error) {
    console.error("POST /api/doctor/appointments/[id]/exam failed:", error);
    await connection.rollback();
    return NextResponse.json({ success: false, message: "Lỗi server" }, { status: 500 });
  } finally {
    connection.release();
  }
}
