// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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

// GET /api/doctor/appointments/{id}
// Xem chi tiet lịch hẹn + thông tin benh nhan + thông tin slot
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

    const [rows] = await db.execute<AppointmentDetailRow[]>(
      `SELECT a.id, a.user_id, a.slot_id, a.doctor_id, a.status, a.note, a.admin_note, a.created_at,
              p.full_name AS patient_name, p.phone AS patient_phone, p.email AS patient_email,
              s.work_date, s.start_time, s.end_time, s.room, s.service_id,
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
        { success: false, message: "Lich hen khong ton tai" },
        { status: 404 }
      );
    }

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
      message: "Lay chi tiet lich hen thanh cong",
      data: {
        ...rows[0],
        medical_records: medicalRecords,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

// PATCH /api/doctor/appointments/{id}
// Doctor xac nhan / hoan tat / huy lịch hẹn
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
    appointmentIdForAudit = appointmentId;
    if (!appointmentId) {
      return NextResponse.json(
        { success: false, message: "appointment_id khong hop le" },
        { status: 400 }
      );
    }

    let body: UpdateAppointmentBody;
    try {
      body = (await req.json()) as UpdateAppointmentBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
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
        { success: false, message: "status khong hop le" },
        { status: 400 }
      );
    }
    if (status === "cancelled" && !decisionNote) {
      return NextResponse.json(
        { success: false, message: "Vui long nhap ly do huy lich" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [rows] = await connection.execute<AppointmentRow[]>(
      `SELECT a.id, a.user_id, a.slot_id, a.doctor_id, a.status, a.note
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
        { success: false, message: "Lich hen khong ton tai" },
        { status: 404 }
      );
    }

    const current = rows[0];

    if (!canTransitionAppointmentStatus(current.status, status)) {
      await connection.rollback();
      return NextResponse.json(
        {
          success: false,
          message: `Khong the chuyen trang thai tu '${current.status}' sang '${status}'`,
        },
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
      [status, status, status === "cancelled" ? `[Bac si huy] ${decisionNote}` : null, status, status, appointmentId]
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
      const message = `Lich hen #${appointmentId} da bi bac si huy. Ly do: ${decisionNote}`;
      await connection.execute<ResultSetHeader>(
        actionUrlReady
          ? `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
             VALUES (?, ?, ?, false, NOW())`
          : `INSERT INTO notifications (user_id, message, is_read, created_at)
             VALUES (?, ?, false, NOW())`,
        actionUrlReady
          ? [current.user_id, message, "/patient/appointments"]
          : [current.user_id, message]
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
      message: "Cap nhat lich hen thanh cong",
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
      detail: "Doctor cap nhat trang thai lich hen that bai",
    });
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
