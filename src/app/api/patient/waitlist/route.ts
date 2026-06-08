import { NextRequest, NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getAppointmentWorkflowSchemaReady } from "@/lib/appointmentWorkflowSchema";

interface SlotRow extends RowDataPacket {
  id: number;
  work_date: string;
  start_time: string;
  end_time: string;
  status: "available" | "full" | "closed" | "locked";
  booked_count: number;
  max_patients: number;
  service_name: string | null;
  doctor_name: string | null;
}

interface WaitlistRow extends RowDataPacket {
  id: number;
  slot_id: number;
  status: "waiting" | "notified" | "booked" | "cancelled";
  note: string | null;
  notified_at: string | null;
  created_at: string;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  service_name: string | null;
  doctor_name: string | null;
}

export async function GET(req: NextRequest) {
  try {
    await getAppointmentWorkflowSchemaReady();
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi benh nhan moi duoc xem danh sach cho" },
        { status: 403 }
      );
    }

    const [rows] = await db.execute<WaitlistRow[]>(
      `SELECT w.id, w.slot_id, w.status, w.note, w.notified_at, w.created_at,
              s.work_date, s.start_time, s.end_time, sv.name AS service_name,
              u.full_name AS doctor_name
       FROM appointment_waitlist w
       LEFT JOIN doctor_schedule_slots s ON s.id = w.slot_id
       LEFT JOIN services sv ON sv.id = s.service_id
       LEFT JOIN doctors d ON d.id = s.doctor_id
       LEFT JOIN users u ON u.id = d.user_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC, w.id DESC`,
      [authUser.id]
    );

    return NextResponse.json({
      success: true,
      message: "Lay danh sach cho thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const connection = await db.getConnection();
  try {
    await getAppointmentWorkflowSchemaReady();
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi benh nhan moi duoc vao danh sach cho" },
        { status: 403 }
      );
    }

    let body: { slot_id?: unknown; note?: unknown };
    try {
      body = (await req.json()) as { slot_id?: unknown; note?: unknown };
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const slotId = typeof body.slot_id === "number" ? Math.floor(body.slot_id) : Number.NaN;
    const note = typeof body.note === "string" ? body.note.trim() : null;
    if (!Number.isFinite(slotId) || slotId <= 0) {
      return NextResponse.json(
        { success: false, message: "slot_id khong hop le" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [slotRows] = await connection.execute<SlotRow[]>(
      `SELECT s.id, s.work_date, s.start_time, s.end_time, s.status, s.booked_count, s.max_patients,
              sv.name AS service_name, u.full_name AS doctor_name
       FROM doctor_schedule_slots s
       LEFT JOIN services sv ON sv.id = s.service_id
       LEFT JOIN doctors d ON d.id = s.doctor_id
       LEFT JOIN users u ON u.id = d.user_id
       WHERE s.id = ?
       FOR UPDATE`,
      [slotId]
    );

    if (slotRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot khong ton tai" },
        { status: 404 }
      );
    }

    const slot = slotRows[0];
    if (slot.status === "locked") {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot nay da bi khoa" },
        { status: 400 }
      );
    }

    if (slot.status === "closed") {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot da dong" },
        { status: 400 }
      );
    }

    if (slot.booked_count < 1) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot nay van con cho, ban co the dat lich truc tiep" },
        { status: 400 }
      );
    }

    const [existsWaiting] = await connection.execute<RowDataPacket[]>(
      `SELECT id
       FROM appointment_waitlist
       WHERE user_id = ? AND slot_id = ? AND status IN ('waiting','notified')
       LIMIT 1`,
      [authUser.id, slotId]
    );
    if (existsWaiting.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Ban da co trong danh sach cho cua slot nay" },
        { status: 409 }
      );
    }

    const [existsAppointment] = await connection.execute<RowDataPacket[]>(
      `SELECT id
       FROM appointments
       WHERE user_id = ? AND slot_id = ? AND status IN ('pending','confirmed','completed')
       LIMIT 1`,
      [authUser.id, slotId]
    );
    if (existsAppointment.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Ban da co lich voi slot nay" },
        { status: 409 }
      );
    }

    await connection.execute<ResultSetHeader>(
      `INSERT INTO appointment_waitlist (user_id, slot_id, note, status, created_at, updated_at)
       VALUES (?, ?, ?, 'waiting', NOW(), NOW())
       ON DUPLICATE KEY UPDATE note = VALUES(note), status = 'waiting', notified_at = NULL, updated_at = NOW()`,
      [authUser.id, slotId, note]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Da them vao danh sach cho",
      data: {
        slot_id: slotId,
        service_name: slot.service_name,
        doctor_name: slot.doctor_name,
        work_date: slot.work_date,
        start_time: slot.start_time,
        end_time: slot.end_time,
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

export async function DELETE(req: NextRequest) {
  try {
    await getAppointmentWorkflowSchemaReady();
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi benh nhan moi duoc roi danh sach cho" },
        { status: 403 }
      );
    }

    const slotId = Number(req.nextUrl.searchParams.get("slot_id"));
    if (!Number.isFinite(slotId) || slotId <= 0) {
      return NextResponse.json(
        { success: false, message: "slot_id khong hop le" },
        { status: 400 }
      );
    }

    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE appointment_waitlist
       SET status = 'cancelled', updated_at = NOW()
       WHERE user_id = ? AND slot_id = ? AND status IN ('waiting','notified')`,
      [authUser.id, slotId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, message: "Khong tim thay ban ghi danh sach cho de huy" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Da roi danh sach cho",
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}
