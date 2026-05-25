import { NextRequest, NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { hasTableColumn } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";
import { getAppointmentWorkflowSchemaReady } from "@/lib/appointmentWorkflowSchema";
import { isClinicSlotInPast } from "@/lib/clinicTime";

type RevisitBody = {
  new_slot_id?: unknown;
  reason?: unknown;
};

interface SourceAppointmentRow extends RowDataPacket {
  id: number;
  user_id: number;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  doctor_id: number | null;
  slot_doctor_id: number | null;
  service_name: string | null;
}

interface SlotRow extends RowDataPacket {
  id: number;
  doctor_id: number;
  booked_count: number;
  max_patients: number;
  work_date: string;
  start_time: string;
  end_time: string;
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();

  try {
    await getAppointmentWorkflowSchemaReady();
    const hasScheduleIdColumn = await hasTableColumn("appointments", "schedule_id");
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi benh nhan moi duoc dat lich tai kham" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const sourceAppointmentId = parseAppointmentId(id);
    if (!sourceAppointmentId) {
      return NextResponse.json(
        { success: false, message: "appointment_id khong hop le" },
        { status: 400 }
      );
    }

    let body: RevisitBody;
    try {
      body = (await req.json()) as RevisitBody;
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

    const [sourceRows] = await connection.execute<SourceAppointmentRow[]>(
      `SELECT a.id, a.user_id, a.status, a.doctor_id,
              s.doctor_id AS slot_doctor_id,
              sv.name AS service_name
       FROM appointments a
       LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
       LEFT JOIN services sv ON sv.id = s.service_id
       WHERE a.id = ?
       FOR UPDATE`,
      [sourceAppointmentId]
    );

    if (sourceRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen goc khong ton tai" },
        { status: 404 }
      );
    }

    const source = sourceRows[0];
    if (source.user_id !== authUser.id) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Khong du quyen tai kham tu lich nay" },
        { status: 403 }
      );
    }

    if (source.status !== "completed") {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chi duoc dat tai kham tu lich da hoan tat" },
        { status: 400 }
      );
    }

    const sourceDoctorId = source.doctor_id || source.slot_doctor_id;
    if (!sourceDoctorId) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Khong tim thay bac si tu lich goc" },
        { status: 400 }
      );
    }

    const [slotRows] = await connection.execute<SlotRow[]>(
      `SELECT id, doctor_id, booked_count, max_patients, work_date, start_time, end_time, status
       FROM doctor_schedule_slots
       WHERE id = ?
       FOR UPDATE`,
      [newSlotId]
    );

    if (slotRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot moi khong ton tai" },
        { status: 404 }
      );
    }

    const slot = slotRows[0];
    if (slot.doctor_id !== sourceDoctorId) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Tai kham chi duoc dat voi cung bac si" },
        { status: 400 }
      );
    }

    if (slot.status === "closed" || slot.status === "full" || slot.booked_count >= slot.max_patients) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot moi khong con cho" },
        { status: 400 }
      );
    }

    if (isClinicSlotInPast(slot.work_date, slot.start_time)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Khong the dat tai kham vao slot da qua" },
        { status: 400 }
      );
    }

    const [overlapRows] = await connection.execute<RowDataPacket[]>(
      `SELECT a.id
       FROM appointments a
       JOIN doctor_schedule_slots s ON s.id = a.slot_id
       WHERE a.user_id = ?
         AND a.status IN ('pending','confirmed')
         AND s.work_date = ?
         AND (s.start_time < ? AND s.end_time > ?)
       LIMIT 1`,
      [authUser.id, slot.work_date, slot.end_time, slot.start_time]
    );

    if (overlapRows.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Ban da co lich trung gio voi slot nay" },
        { status: 400 }
      );
    }

    await connection.execute<ResultSetHeader>(
      `UPDATE doctor_schedule_slots
       SET booked_count = booked_count + 1
       WHERE id = ?`,
      [newSlotId]
    );

    if (slot.booked_count + 1 >= slot.max_patients) {
      await connection.execute<ResultSetHeader>(
        `UPDATE doctor_schedule_slots
         SET status = 'full'
         WHERE id = ?`,
        [newSlotId]
      );
    }

    const noteParts = [`[Tai kham tu lich #${sourceAppointmentId}]`];
    if (source.service_name) {
      noteParts.push(`Dich vu truoc: ${source.service_name}`);
    }
    if (reason) {
      noteParts.push(`Ly do tai kham: ${reason}`);
    }

    const [insertResult] = hasScheduleIdColumn
      ? await connection.execute<ResultSetHeader>(
          `INSERT INTO appointments (user_id, slot_id, doctor_id, schedule_id, status, note, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?, NOW())`,
          [authUser.id, newSlotId, sourceDoctorId, newSlotId, noteParts.join("\n")]
        )
      : await connection.execute<ResultSetHeader>(
          `INSERT INTO appointments (user_id, slot_id, doctor_id, status, note, created_at)
           VALUES (?, ?, ?, 'pending', ?, NOW())`,
          [authUser.id, newSlotId, sourceDoctorId, noteParts.join("\n")]
        );

    await connection.execute<ResultSetHeader>(
      `UPDATE appointment_waitlist
       SET status = 'booked', updated_at = NOW()
       WHERE user_id = ? AND slot_id = ? AND status IN ('waiting','notified')`,
      [authUser.id, newSlotId]
    );

    const [doctorRows] = await connection.execute<DoctorUserRow[]>(
      "SELECT user_id FROM doctors WHERE id = ? LIMIT 1",
      [sourceDoctorId]
    );
    const doctorUserId = doctorRows[0]?.user_id ?? null;

    const actionUrlReady = await getNotificationActionUrlReady();
    if (actionUrlReady) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
         VALUES (?, ?, ?, false, NOW())`,
        [authUser.id, `Dat lich tai kham thanh cong (#${insertResult.insertId})`, "/patient/appointments"]
      );

      if (doctorUserId) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
           VALUES (?, ?, ?, false, NOW())`,
          [doctorUserId, `Ban co lich tai kham moi (#${insertResult.insertId})`, "/doctor/appointments"]
        );
      }
    } else {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO notifications (user_id, message, is_read, created_at)
         VALUES (?, ?, false, NOW())`,
        [authUser.id, `Dat lich tai kham thanh cong (#${insertResult.insertId})`]
      );

      if (doctorUserId) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO notifications (user_id, message, is_read, created_at)
           VALUES (?, ?, false, NOW())`,
          [doctorUserId, `Ban co lich tai kham moi (#${insertResult.insertId})`]
        );
      }
    }

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Dat tai kham thanh cong",
      data: {
        appointment_id: insertResult.insertId,
        source_appointment_id: sourceAppointmentId,
        slot_id: newSlotId,
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
