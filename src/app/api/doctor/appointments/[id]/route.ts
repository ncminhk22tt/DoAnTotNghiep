// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có transaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db, hasTableColumn } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";
import { canTransitionAppointmentStatus } from "@/lib/appointmentStatus";
import { getAppointmentDecisionSchemaReady } from "@/lib/appointmentDecisionSchema";
import { getAppointmentWorkflowSchemaReady } from "@/lib/appointmentWorkflowSchema";
import { writeAuditLog } from "@/lib/auditLog";
import { notifyWaitingPatientForSlot } from "@/lib/waitlistService";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";

type UpdateAppointmentBody = {
  status?: unknown;
  decision_note?: unknown;
};

interface AppointmentRow extends RowDataPacket {
  id: number;
  user_id: number;
  slot_id: number | null;
  doctor_id: number | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  note: string | null;
  work_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

interface AppointmentDetailRow extends RowDataPacket {
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
  patient_email: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  service_id: number | null;
  service_name: string | null;
  exam_allowed?: number | null;
}

interface MedicalRecordRow extends RowDataPacket {
  id: number;
  diagnosis: string | null;
  notes: string | null;
  created_at: string | null;
}

interface PrescriptionRow extends RowDataPacket {
  id: number;
  medical_record_id: number;
}

interface PrescriptionItemRow extends RowDataPacket {
  id: number;
  prescription_id: number;
  medicine_name: string;
  dosage: string;
  duration: string;
}

interface SlotRow extends RowDataPacket {
  id: number;
  booked_count: number;
  max_patients: number;
  status: "available" | "full" | "closed";
}

function parseAppointmentId(id: string): number | null {
  const appointmentId = Number(id);
  if (!id || Number.isNaN(appointmentId) || appointmentId <= 0) return null;
  return appointmentId;
}

function getClinicNowParts() {
  return {
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date()),
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

function isAppointmentTimePassed(workDate: unknown, endTime: unknown) {
  const workDateText = toClinicDateString(workDate);
  const endTimeText = toClinicTimeString(endTime);
  if (!workDateText || !endTimeText) return false;
  const now = getClinicNowParts();
  const appointmentTime = `${workDateText} ${endTimeText}`;
  const currentTime = `${now.date} ${now.time}`;
  return appointmentTime <= currentTime;
}

function isAppointmentStartReached(workDate: unknown, startTime: unknown) {
  const workDateText = toClinicDateString(workDate);
  const startTimeText = toClinicTimeString(startTime);
  if (!workDateText || !startTimeText) return false;
  const now = getClinicNowParts();
  const appointmentTime = `${workDateText} ${startTimeText}`;
  const currentTime = `${now.date} ${now.time}`;
  return appointmentTime <= currentTime;
}

// GET /api/doctor/appointments/{id}
// Xem chi tiết lịch hẹn + thông tin bệnh nhân + thông tin slot
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const hasAdminNoteColumn = await hasTableColumn("appointments", "admin_note");

    const [rows] = await db.execute<AppointmentDetailRow[]>(
      `SELECT a.id, a.user_id, a.slot_id, a.doctor_id, a.status, a.note, ${hasAdminNoteColumn ? "a.admin_note" : "NULL AS admin_note"}, a.created_at,
              p.full_name AS patient_name, p.phone AS patient_phone, p.email AS patient_email,
              DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
              TIME_FORMAT(s.start_time, '%H:%i:%s') AS start_time,
              TIME_FORMAT(s.end_time, '%H:%i:%s') AS end_time,
              s.room, s.service_id,
              sv.name AS service_name
       FROM appointments a
       JOIN users p ON p.id = a.user_id
       LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
       LEFT JOIN services sv ON sv.id = s.service_id
       WHERE a.id = ?
         AND COALESCE(a.doctor_id, s.doctor_id) = ?
       LIMIT 1`,
      [appointmentId, doctorProfileId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Lịch hẹn không tồn tại" },
        { status: 404 }
      );
    }

    const examAllowed = isAppointmentStartReached(rows[0].work_date, rows[0].start_time) ? 1 : 0;

    const [medicalRows] = await db.execute<MedicalRecordRow[]>(
      `SELECT id, diagnosis, notes, created_at
       FROM medical_records
       WHERE appointment_id = ?
       ORDER BY id DESC`,
      [appointmentId]
    );

    const medicalRecords = [];
    for (const record of medicalRows) {
      const [prescriptionRows] = await db.execute<PrescriptionRow[]>(
        `SELECT id, medical_record_id
         FROM prescriptions
         WHERE medical_record_id = ?
         ORDER BY id DESC`,
        [record.id]
      );

      const prescriptions = [];
      for (const p of prescriptionRows) {
        const [itemRows] = await db.execute<PrescriptionItemRow[]>(
          `SELECT id, prescription_id, medicine_name, dosage, duration
           FROM prescription_items
           WHERE prescription_id = ?
           ORDER BY id ASC`,
          [p.id]
        );
        prescriptions.push({
          ...p,
          items: itemRows,
        });
      }

      medicalRecords.push({
        ...record,
        prescriptions,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Lấy chi tiết lịch hẹn thành công",
      data: {
        ...rows[0],
        exam_allowed: Boolean(examAllowed),
        medical_records: medicalRecords,
      },
    });
  } catch (error) {
    console.error("GET /api/doctor/appointments/[id] failed:", error);
    return NextResponse.json({ success: false, message: "Lỗi server" }, { status: 500 });
  }
}

// PATCH /api/doctor/appointments/{id}
// Bác sĩ xác nhận / hoàn tất / hủy lịch hẹn
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();
  let appointmentIdForAudit: number | null = null;

  try {
    await getAppointmentDecisionSchemaReady();
    await getAppointmentWorkflowSchemaReady();
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
    appointmentIdForAudit = appointmentId;
    if (!appointmentId) {
      return NextResponse.json(
        { success: false, message: "appointment_id không hợp lệ" },
        { status: 400 }
      );
    }

    let body: UpdateAppointmentBody;
    try {
      body = (await req.json()) as UpdateAppointmentBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON không hợp lệ" },
        { status: 400 }
      );
    }

    const status =
      typeof body.status === "string" && ["pending", "confirmed", "completed", "cancelled", "no_show"].includes(body.status)
        ? (body.status as AppointmentRow["status"])
        : null;
    const decisionNote = typeof body.decision_note === "string" ? body.decision_note.trim() : "";
    if (!status) {
      return NextResponse.json(
        { success: false, message: "status không hợp lệ" },
        { status: 400 }
      );
    }
    if (status === "cancelled" && !decisionNote) {
      return NextResponse.json(
        { success: false, message: "Vui lòng nhập lý do hủy lịch" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [rows] = await connection.execute<AppointmentRow[]>(
      `SELECT a.id, a.user_id, a.slot_id, a.doctor_id, a.status, a.note,
              DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
              TIME_FORMAT(s.start_time, '%H:%i:%s') AS start_time,
              TIME_FORMAT(s.end_time, '%H:%i:%s') AS end_time
       FROM appointments a
       LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
       WHERE a.id = ?
         AND COALESCE(a.doctor_id, s.doctor_id) = ?
       FOR UPDATE`,
      [appointmentId, doctorProfileId]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lịch hẹn không tồn tại" },
        { status: 404 }
      );
    }

    const current = rows[0];

    if (!canTransitionAppointmentStatus(current.status, status)) {
      await connection.rollback();
      return NextResponse.json(
        {
          success: false,
          message: `Không thể chuyển trạng thái từ '${current.status}' sang '${status}'`,
        },
        { status: 400 }
      );
    }

    if (status === "no_show" && !isAppointmentTimePassed(current.work_date || null, current.end_time || null)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chỉ có thể đánh dấu vắng mặt sau giờ khám." },
        { status: 400 }
      );
    }

    if (status === "cancelled" && isAppointmentStartReached(current.work_date || null, current.start_time || null)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Không thể hủy lịch hẹn khi đã tới giờ khám." },
        { status: 400 }
      );
    }

    await connection.execute<ResultSetHeader>(
      `UPDATE appointments
       SET status = ?,
           admin_note = CASE WHEN ? = 'cancelled' THEN ? ELSE admin_note END,
           checked_in_at = CASE WHEN ? = 'cancelled' THEN NULL ELSE checked_in_at END,
           checked_in_by = CASE WHEN ? = 'cancelled' THEN NULL ELSE checked_in_by END
       WHERE id = ?`,
      [status, status, status === "cancelled" ? `[Bác sĩ hủy] ${decisionNote}` : null, status, status, appointmentId]
    );

    if (current.slot_id && status === "cancelled" && ["pending", "confirmed"].includes(current.status)) {
      const [slotRows] = await connection.execute<SlotRow[]>(
        `SELECT id, booked_count, max_patients, status
         FROM doctor_schedule_slots
         WHERE id = ?
         FOR UPDATE`,
        [current.slot_id]
      );
      if (slotRows.length > 0) {
        const slot = slotRows[0];
        await connection.execute<ResultSetHeader>(
          `UPDATE doctor_schedule_slots
           SET booked_count = GREATEST(booked_count - 1, 0)
           WHERE id = ?`,
          [slot.id]
        );
        const nextBooked = Math.max(slot.booked_count - 1, 0);
        if (slot.status === "full" && nextBooked < slot.max_patients) {
          await connection.execute<ResultSetHeader>(
            `UPDATE doctor_schedule_slots
             SET status = 'available'
             WHERE id = ?`,
            [slot.id]
          );
        }
        if (nextBooked < slot.max_patients) {
          await notifyWaitingPatientForSlot(connection, slot.id);
        }
      }
    }

    if (status === "cancelled") {
      const actionUrlReady = await getNotificationActionUrlReady();
      const message = `Lịch hẹn #${appointmentId} đã bị bác sĩ hủy. Lý do: ${decisionNote}`;
      await connection.execute<ResultSetHeader>(
        actionUrlReady
          ? `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
             VALUES (?, ?, ?, false, NOW())`
          : `INSERT INTO notifications (user_id, message, is_read, created_at)
             VALUES (?, ?, false, NOW())`,
        actionUrlReady ? [current.user_id, message, "/patient/appointments"] : [current.user_id, message]
      );
    }

    await connection.commit();
    await writeAuditLog({
      user_id: authUser.id,
      action: "doctor_appointment_status_update",
      entity_type: "appointment",
      entity_id: appointmentId,
      status: "success",
      detail: `status: ${current.status} -> ${status}`,
    });

    return NextResponse.json({
      success: true,
      message: "Cập nhật lịch hẹn thành công",
      data: {
        appointment_id: appointmentId,
        old_status: current.status,
        new_status: status,
      },
    });
  } catch {
    await connection.rollback();
    await writeAuditLog({
      action: "doctor_appointment_status_update",
      entity_type: "appointment",
      entity_id: appointmentIdForAudit,
      status: "failed",
      detail: "Cập nhật trạng thái lịch hẹn thất bại",
    });
    return NextResponse.json({ success: false, message: "Lỗi server" }, { status: 500 });
  } finally {
    connection.release();
  }
}
