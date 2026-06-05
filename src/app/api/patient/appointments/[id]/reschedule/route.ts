import { NextRequest, NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { hasTableColumn } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";
import { getAppointmentDecisionSchemaReady } from "@/lib/appointmentDecisionSchema";
import { getAppointmentWorkflowSchemaReady } from "@/lib/appointmentWorkflowSchema";
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
  admin_note: string | null;
}

interface SlotRow extends RowDataPacket {
  id: number;
  doctor_id: number;
  service_id: number | null;
  work_date: string;
  start_time: string;
  end_time: string;
  booked_count: number;
  max_patients: number;
  status: "available" | "full" | "closed";
}

interface DoctorUserRow extends RowDataPacket {
  user_id: number;
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
  try {
    await getAppointmentWorkflowSchemaReady();
    await getAppointmentDecisionSchemaReady();
    const hasScheduleIdColumn = await hasTableColumn("appointments", "schedule_id");

    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi benh nhan moi duoc doi lich" },
        { status: 403 }
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

    await connection.beginTransaction();

    const [appointmentRows] = await connection.execute<AppointmentRow[]>(
      `SELECT id, user_id, slot_id, doctor_id, status, admin_note
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

    if (appointment.user_id !== authUser.id) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Khong du quyen doi lich nay" },
        { status: 403 }
      );
    }
    if (!["pending", "confirmed"].includes(appointment.status)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chi doi duoc lich dang cho xac nhan hoac da xac nhan" },
        { status: 400 }
      );
    }
    if ((appointment.admin_note || "").includes("[Yeu cau doi lich]")) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen nay da doi lich mot lan, khong the doi them." },
        { status: 400 }
      );
    }
    if (!appointment.slot_id) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hien tai khong co slot" },
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
      `SELECT id, doctor_id, service_id, work_date, start_time, end_time, booked_count, max_patients, status
       FROM doctor_schedule_slots
       WHERE id = ?
       FOR UPDATE`,
      [appointment.slot_id]
    );
    const [newSlotRows] = await connection.execute<SlotRow[]>(
      `SELECT id, doctor_id, service_id, work_date, start_time, end_time, booked_count, max_patients, status
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
        { success: false, message: "Chi duoc doi sang slot cung bac si" },
        { status: 400 }
      );
    }

    if (newSlot.status === "closed" || newSlot.status === "full" || newSlot.booked_count >= newSlot.max_patients) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot moi khong con cho" },
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

    const [overlapRows] = await connection.execute<RowDataPacket[]>(
      `SELECT a.id
       FROM appointments a
       JOIN doctor_schedule_slots s ON s.id = a.slot_id
       WHERE a.user_id = ?
         AND a.id <> ?
         AND a.status IN ('pending','confirmed')
         AND s.work_date = ?
         AND (s.start_time < ? AND s.end_time > ?)
       LIMIT 1`,
      [authUser.id, appointmentId, newSlot.work_date, newSlot.end_time, newSlot.start_time]
    );
    if (overlapRows.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Ban da co lich trung gio voi slot moi" },
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
    if (oldSlot.status === "full" && oldAfter < oldSlot.max_patients) {
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
    if (newSlot.booked_count + 1 >= newSlot.max_patients) {
      await connection.execute<ResultSetHeader>(
        "UPDATE doctor_schedule_slots SET status = 'full' WHERE id = ?",
        [newSlot.id]
      );
    }

    const patientNotePrefix = reason ? `[Yeu cau doi lich] ${reason}` : "[Yeu cau doi lich]";
    const nextAdminNote = `${patientNotePrefix} | ${oldSlot.work_date} ${oldSlot.start_time.slice(0, 5)}-${oldSlot.end_time.slice(0, 5)} -> ${newSlot.work_date} ${newSlot.start_time.slice(0, 5)}-${newSlot.end_time.slice(0, 5)}`;

    await connection.execute<ResultSetHeader>(
      hasScheduleIdColumn
        ? `UPDATE appointments
           SET slot_id = ?, schedule_id = ?, doctor_id = ?, status = 'pending', admin_note = ?, checked_in_at = NULL, checked_in_by = NULL
           WHERE id = ?`
        : `UPDATE appointments
           SET slot_id = ?, doctor_id = ?, status = 'pending', admin_note = ?, checked_in_at = NULL, checked_in_by = NULL
           WHERE id = ?`,
      hasScheduleIdColumn
        ? [newSlot.id, newSlot.id, newSlot.doctor_id, nextAdminNote, appointmentId]
        : [newSlot.id, newSlot.doctor_id, nextAdminNote, appointmentId]
    );

    await connection.execute<ResultSetHeader>(
      `UPDATE appointment_waitlist
       SET status = 'booked', updated_at = NOW()
       WHERE user_id = ? AND slot_id = ? AND status IN ('waiting','notified')`,
      [authUser.id, newSlot.id]
    );

    if (oldAfter < oldSlot.max_patients) {
      await notifyWaitingPatientForSlot(connection, oldSlot.id);
    }

    const [doctorRows] = await connection.execute<DoctorUserRow[]>(
      "SELECT user_id FROM doctors WHERE id = ? LIMIT 1",
      [newSlot.doctor_id]
    );
    const doctorUserId = doctorRows[0]?.user_id ?? null;

    const actionUrlReady = await getNotificationActionUrlReady();
    const patientMessage = `Doi lich thanh cong: ${newSlot.work_date} ${newSlot.start_time.slice(0, 5)}-${newSlot.end_time.slice(0, 5)}`;
    if (actionUrlReady) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
         VALUES (?, ?, ?, false, NOW())`,
        [authUser.id, patientMessage, "/patient/appointments"]
      );
      if (doctorUserId) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
           VALUES (?, ?, ?, false, NOW())`,
          [
            doctorUserId,
            `Benh nhan da doi lich hen #${appointmentId} sang ${newSlot.work_date} ${newSlot.start_time.slice(0, 5)}-${newSlot.end_time.slice(0, 5)}`,
            "/doctor/appointments",
          ]
        );
      }
    } else {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO notifications (user_id, message, is_read, created_at)
         VALUES (?, ?, false, NOW())`,
        [authUser.id, patientMessage]
      );
      if (doctorUserId) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO notifications (user_id, message, is_read, created_at)
           VALUES (?, ?, false, NOW())`,
          [
            doctorUserId,
            `Benh nhan da doi lich hen #${appointmentId} sang ${newSlot.work_date} ${newSlot.start_time.slice(0, 5)}-${newSlot.end_time.slice(0, 5)}`,
          ]
        );
      }
    }

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Doi lich thanh cong",
      data: {
        appointment_id: appointmentId,
        old_slot_id: oldSlot.id,
        new_slot_id: newSlot.id,
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
