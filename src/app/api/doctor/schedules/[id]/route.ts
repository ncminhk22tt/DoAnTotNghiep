// NOTE Há»ŒC API:
// - Máº«u Ä‘á»c nhanh: auth/validate -> query DB -> business rule -> tráº£ JSON.
// - Náº¿u route cĂ³ tráº£nsaction: nhá»› beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { ScheduleSlot } from "@/types/slot";
import { getDoctorProfileId } from "@/lib/doctorProfile";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";
import { ensureScheduleClosedStatus } from "@/lib/scheduleSchema";

type UpdateScheduleBody = {
  service_id?: unknown;
  work_date?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  room?: unknown;
  price?: unknown;
  max_patients?: unknown;
  status?: unknown;
};

interface DoctorServiceRow extends RowDataPacket {
  service_id: number;
}

interface SlotRow extends ScheduleSlot {}

interface AppointmentCheckRow extends RowDataPacket {
  id: number;
}

function parseSlotId(id: string): number | null {
  const slotId = Number(id);
  if (!id || Number.isNaN(slotId) || slotId <= 0) return null;
  return slotId;
}

function normalizeDateOnly(input: unknown): string | null {
  if (typeof input === "string") {
    const raw = input.trim();
    if (!raw) return null;
    if (raw.includes("T")) return raw.split("T")[0];
    if (raw.includes(" ")) return raw.split(" ")[0];
    return raw.slice(0, 10);
  }

  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return input.toISOString().slice(0, 10);
  }

  return null;
}

function getTodayInVietnam(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// GET /api/doctor/schedules/{id}
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureScheduleClosedStatus();

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
    const slotId = parseSlotId(id);
    if (!slotId) {
      return NextResponse.json(
        { success: false, message: "slot_id không hợp lệ" },
        { status: 400 }
      );
    }

    const [rows] = await db.execute<SlotRow[]>(
      `SELECT id, doctor_id, service_id, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date, start_time, end_time, room, price, max_patients, booked_count, status
       FROM doctor_schedule_slots
       WHERE id = ? AND doctor_id = ?
       LIMIT 1`,
      [slotId, doctorProfileId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Slot không tồn tại" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Lấy chi tiết slot thành công",
      data: rows[0],
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Lỗi server" },
      { status: 500 }
    );
  }
}

// PUT /api/doctor/schedules/{id}
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();

  try {
    await ensureScheduleClosedStatus();

    const softDeleteReady = await getServiceSoftDeleteReady();

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
    const slotId = parseSlotId(id);
    if (!slotId) {
      return NextResponse.json(
        { success: false, message: "slot_id không hợp lệ" },
        { status: 400 }
      );
    }

    let body: UpdateScheduleBody;
    try {
      body = (await req.json()) as UpdateScheduleBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON không hợp lệ" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [slotRows] = await connection.execute<SlotRow[]>(
      `SELECT id, doctor_id, service_id, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date, start_time, end_time, room, price, max_patients, booked_count, status
       FROM doctor_schedule_slots
       WHERE id = ? AND doctor_id = ?
       FOR UPDATE`,
      [slotId, doctorProfileId]
    );

    if (slotRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot không tồn tại" },
        { status: 404 }
      );
    }

    const current = slotRows[0];

    const service_id = typeof body.service_id === "number" ? body.service_id : current.service_id;
    const work_date = normalizeDateOnly(
      body.work_date !== undefined ? body.work_date : current.work_date
    );
    const start_time = typeof body.start_time === "string" ? body.start_time : current.start_time;
    const end_time = typeof body.end_time === "string" ? body.end_time : current.end_time;
    const room = typeof body.room === "string" ? body.room : current.room;
    const price = typeof body.price === "number" ? body.price : current.price;
    const max_patients = typeof body.max_patients === "number" ? body.max_patients : current.max_patients;

    if (!service_id || !work_date || !start_time || !end_time || !max_patients) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Dữ liệu cập nhật không hợp lệ" },
        { status: 400 }
      );
    }

    const today = getTodayInVietnam();
    if (work_date < today) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Không thể sửa lịch của ngày đã qua" },
        { status: 400 }
      );
    }

    if (start_time >= end_time) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Thời gian không hợp lệ" },
        { status: 400 }
      );
    }

    if (max_patients < current.booked_count) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "max_patients không được nhỏ hơn booked_count" },
        { status: 400 }
      );
    }

    const [doctorServiceRows] = await connection.execute<DoctorServiceRow[]>(
      softDeleteReady
        ? `SELECT ds.service_id
           FROM doctor_services ds
           JOIN services s ON s.id = ds.service_id
           WHERE ds.doctor_id = ? AND ds.service_id = ? AND s.is_active = 1
           LIMIT 1`
        : `SELECT service_id
           FROM doctor_services
           WHERE doctor_id = ? AND service_id = ?
           LIMIT 1`,
      [doctorProfileId, service_id]
    );

    if (doctorServiceRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Dịch vụ không thuộc bác sĩ này" },
        { status: 400 }
      );
    }

    const requestedStatus =
      typeof body.status === "string" && ["available", "full", "closed"].includes(body.status)
        ? (body.status as "available" | "full" | "closed")
        : null;

    const computedStatus =
      current.booked_count >= max_patients ? "full" : "available";

    const finalStatus = requestedStatus ?? (current.status === "closed" ? "closed" : computedStatus);

    await connection.execute<ResultSetHeader>(
      `UPDATE doctor_schedule_slots
       SET service_id = ?, work_date = ?, start_time = ?, end_time = ?, room = ?, price = ?, max_patients = ?, status = ?
       WHERE id = ?`,
      [service_id, work_date, start_time, end_time, room, price, max_patients, finalStatus, slotId]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Cập nhật slot thành công",
    });
  } catch (error) {
    await connection.rollback();

    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { success: false, message: "Trùng giờ đã tồn tại" },
        { status: 409 }
      );
    }

    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Lỗi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}

// DELETE /api/doctor/schedules/{id}
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();

  try {
    await ensureScheduleClosedStatus();

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
    const slotId = parseSlotId(id);
    if (!slotId) {
      return NextResponse.json(
        { success: false, message: "slot_id không hợp lệ" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [slotRows] = await connection.execute<SlotRow[]>(
      "SELECT id FROM doctor_schedule_slots WHERE id = ? AND doctor_id = ? FOR UPDATE",
      [slotId, doctorProfileId]
    );

    if (slotRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot không tồn tại" },
        { status: 404 }
      );
    }

    const [appointmentRows] = await connection.execute<AppointmentCheckRow[]>(
      `SELECT id
       FROM appointments
       WHERE slot_id = ?
         AND status IN ('pending', 'confirmed')
       LIMIT 1`,
      [slotId]
    );

    if (appointmentRows.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot đang có lịch hẹn, không thể xóa" },
        { status: 400 }
      );
    }

    await connection.execute<ResultSetHeader>(
      "DELETE FROM doctor_schedule_slots WHERE id = ?",
      [slotId]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Xóa slot thành công",
    });
  } catch {
    await connection.rollback();
    return NextResponse.json(
      { success: false, message: "Lỗi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
