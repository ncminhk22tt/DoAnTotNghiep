import { NextRequest, NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { hasTableColumn } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";
import { getAppointmentDecisionSchemaReady } from "@/lib/appointmentDecisionSchema";
import { getAppointmentWorkflowSchemaReady } from "@/lib/appointmentWorkflowSchema";
import { writeAuditLog } from "@/lib/auditLog";
import { notifyWaitingPatientForSlot } from "@/lib/waitlistService";
import { isClinicSlotInPast } from "@/lib/clinicTime";

type RescheduleBody = {
  new_slot_id?: unknown;
  reason?: unknown;
};

interface AppointmentRow extends RowDataPacket {
  id: number;
  user_id: number;
  slot_id: number | null;
  doctor_id: number | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
}

interface SlotRow extends RowDataPacket {
  id: number;
  doctor_id: number;
  work_date: string;
  start_time: string;
  end_time: string;
  booked_count: number;
  max_patients: number;
  status: "available" | "full" | "closed";
}

function parseAppointmentId(id: string): number | null {
  const appointmentId = Number(id);
  if (!id || Number.isNaN(appointmentId) || appointmentId <= 0) return null;
  return appointmentId;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();
  let appointmentIdForAudit: number | null = null;

  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "admin") {
      return NextResponse.json(
        { success: false, message: "Chi admin moi duoc doi lich hen" },
        { status: 403 }
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

    let body: RescheduleBody;
    try {
      body = (await req.json()) as RescheduleBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const newSlotId =
      typeof body.new_slot_id === "number" ? Math.floor(body.new_slot_id) : Number.NaN;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!Number.isFinite(newSlotId) || newSlotId <= 0) {
      return NextResponse.json(
        { success: false, message: "new_slot_id khong hop le" },
        { status: 400 }
      );
    }
    if (!reason) {
      return NextResponse.json(
        { success: false, message: "Vui long nhap ly do doi lich" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();
    await getAppointmentWorkflowSchemaReady();
    await getAppointmentDecisionSchemaReady();
    const hasAppointmentDayColumn = await hasTableColumn("appointments", "appointment_day");

    const [appointmentRows] = await connection.execute<AppointmentRow[]>(
      `SELECT id, user_id, slot_id, doctor_id, status
       FROM appointments
       WHERE id = ?
       FOR UPDATE`,
      [appointmentId]
    );
    if (appointmentRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen khong ton tai" },
        { status: 404 }
      );
    }
    const appointment = appointmentRows[0];
    if (!["pending", "confirmed", "no_show"].includes(appointment.status)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chi doi lich cho lich chua hoan tat/huy" },
        { status: 400 }
      );
    }
    if (!appointment.slot_id) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen hien tai khong co slot" },
        { status: 400 }
      );
    }
    if (appointment.slot_id === newSlotId) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot moi trung slot hien tai" },
        { status: 400 }
      );
    }

    const [oldSlotRows] = await connection.execute<SlotRow[]>(
      `SELECT id, doctor_id, work_date, start_time, end_time, booked_count, max_patients, status
       FROM doctor_schedule_slots
       WHERE id = ?
       FOR UPDATE`,
      [appointment.slot_id]
    );
    const [newSlotRows] = await connection.execute<SlotRow[]>(
      `SELECT id, doctor_id, work_date, start_time, end_time, booked_count, max_patients, status
       FROM doctor_schedule_slots
       WHERE id = ?
       FOR UPDATE`,
      [newSlotId]
    );
    if (oldSlotRows.length === 0 || newSlotRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Khong tim thay slot can doi" },
        { status: 404 }
      );
    }

    const oldSlot = oldSlotRows[0];
    const newSlot = newSlotRows[0];
    if (oldSlot.doctor_id !== newSlot.doctor_id) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chi doi lich trong cung bac si" },
        { status: 400 }
      );
    }
    if (newSlot.status === "closed" || newSlot.status === "full" || newSlot.booked_count >= 1) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot moi khong con cho" },
        { status: 400 }
      );
    }

    const [sameDayRows] = await connection.execute<RowDataPacket[]>(
      `SELECT a.id
       FROM appointments a
       JOIN doctor_schedule_slots s ON s.id = a.slot_id
       WHERE a.user_id = ?
         AND a.id <> ?
         AND a.status IN ('pending','confirmed')
         AND s.work_date = ?
       LIMIT 1`,
      [appointment.user_id, appointmentId, newSlot.work_date]
    );
    if (sameDayRows.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Bạn chỉ được đặt 1 lịch khám trong cùng một ngày" },
        { status: 400 }
      );
    }

    if (isClinicSlotInPast(newSlot.work_date, newSlot.start_time)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Khong the doi sang slot trong qua khu" },
        { status: 400 }
      );
    }

    await connection.execute<ResultSetHeader>(
      `UPDATE doctor_schedule_slots
       SET booked_count = GREATEST(booked_count - 1, 0)
       WHERE id = ?`,
      [oldSlot.id]
    );

    const oldAfter = Math.max(oldSlot.booked_count - 1, 0);
    if (oldSlot.status === "full" && oldAfter < 1) {
      await connection.execute<ResultSetHeader>(
        "UPDATE doctor_schedule_slots SET status = 'available' WHERE id = ?",
        [oldSlot.id]
      );
    }

    await connection.execute<ResultSetHeader>(
      `UPDATE doctor_schedule_slots
       SET booked_count = booked_count + 1
       WHERE id = ?`,
      [newSlot.id]
    );

    if (newSlot.booked_count + 1 >= 1) {
      await connection.execute<ResultSetHeader>(
        "UPDATE doctor_schedule_slots SET status = 'full' WHERE id = ?",
        [newSlot.id]
      );
    }

    await connection.execute<ResultSetHeader>(
      hasAppointmentDayColumn
        ? `UPDATE appointments
           SET slot_id = ?, schedule_id = ?, appointment_day = ?, doctor_id = ?, status = 'pending', admin_note = ?, checked_in_at = NULL, checked_in_by = NULL
           WHERE id = ?`
        : `UPDATE appointments
           SET slot_id = ?, schedule_id = ?, doctor_id = ?, status = 'pending', admin_note = ?, checked_in_at = NULL, checked_in_by = NULL
           WHERE id = ?`,
      hasAppointmentDayColumn
        ? [newSlot.id, newSlot.id, newSlot.work_date, newSlot.doctor_id, reason, appointmentId]
        : [newSlot.id, newSlot.id, newSlot.doctor_id, reason, appointmentId]
    );

    if (oldAfter < 1) {
      await notifyWaitingPatientForSlot(connection, oldSlot.id);
    }

    const actionUrlReady = await getNotificationActionUrlReady();
    await connection.execute<ResultSetHeader>(
      actionUrlReady
        ? `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
           VALUES (?, ?, ?, false, NOW())`
        : `INSERT INTO notifications (user_id, message, is_read, created_at)
           VALUES (?, ?, false, NOW())`,
      actionUrlReady
        ? [appointment.user_id, `Lich hen #${appointmentId} da duoc doi lich. Ly do: ${reason}`, "/patient/appointments"]
        : [appointment.user_id, `Lich hen #${appointmentId} da duoc doi lich. Ly do: ${reason}`]
    );

    await connection.commit();

    await writeAuditLog({
      user_id: authUser.id,
      action: "admin_appointment_reschedule",
      entity_type: "appointment",
      entity_id: appointmentId,
      status: "success",
      detail: `slot ${oldSlot.id} -> ${newSlot.id}; reason: ${reason}`,
    });

    return NextResponse.json({
      success: true,
      message: "Doi lich thanh cong",
      data: {
        appointment_id: appointmentId,
        old_slot_id: oldSlot.id,
        new_slot_id: newSlot.id,
      },
    });
  } catch (error) {
    await connection.rollback();
    await writeAuditLog({
      action: "admin_appointment_reschedule",
      entity_type: "appointment",
      entity_id: appointmentIdForAudit,
      status: "failed",
      detail: "Doi lich that bai",
    });
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { success: false, message: "Slot moi da co lich kham" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
