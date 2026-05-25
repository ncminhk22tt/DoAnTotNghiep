import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSlots } from "@/lib/generateSlots";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { RowDataPacket } from "mysql2";
import { ScheduleSlot } from "@/types/slot";
import { getDoctorProfileId } from "@/lib/doctorProfile";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";
import { ensureScheduleClosedStatus } from "@/lib/scheduleSchema";

// FILE HỌC LỊCH LÀM VIỆC CỦA DOCTOR:
// - GET: xem danh sach slot lich.
// - POST: tao hang loat slot tu 1 khoang thoi gian.

interface CreateScheduleBody {
  work_date: string;
  start_time: string;
  end_time: string;
  slot_duration: number;
  service_id: number;
  price: number;
  room?: string;
  max_patients?: number;
}

interface DoctorServiceRow extends RowDataPacket {
  service_id: number;
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

// GET /api/doctor/schedules
// Xem danh sach slot cua doctor hien tai (co the filter theo date/status/service_id)
export async function GET(req: NextRequest) {
  try {
    await ensureScheduleClosedStatus();

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

    const date = req.nextUrl.searchParams.get("date");
    const status = req.nextUrl.searchParams.get("status");
    const serviceIdParam = req.nextUrl.searchParams.get("service_id");

    // SQL nen duoc ghep tung dieu kien de filter linh hoat.
    let sql =
      "SELECT id, doctor_id, service_id, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date, start_time, end_time, room, price, max_patients, booked_count, status FROM doctor_schedule_slots WHERE doctor_id = ?";
    const params: Array<string | number> = [doctorProfileId];

    if (date) {
      sql += " AND work_date = ?";
      params.push(date);
    }

    if (status && ["available", "full", "closed"].includes(status)) {
      sql += " AND status = ?";
      params.push(status);
    }

    if (serviceIdParam) {
      const serviceId = Number(serviceIdParam);
      if (Number.isNaN(serviceId) || serviceId <= 0) {
        return NextResponse.json(
          { success: false, message: "service_id khong hop le" },
          { status: 400 }
        );
      }
      sql += " AND service_id = ?";
      params.push(serviceId);
    }

    sql += " ORDER BY work_date ASC, start_time ASC";

    const [rows] = await db.execute<ScheduleSlot[]>(sql, params);
    const data = rows;

    return NextResponse.json({
      success: true,
      message: "Lay lich kham thanh cong",
      data,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

// POST /api/doctor/schedules
// Tao nhieu slot lịch khám trong 1 ca
export async function POST(req: NextRequest) {
  const connection = await db.getConnection();

  try {
    await ensureScheduleClosedStatus();

    const softDeleteReady = await getServiceSoftDeleteReady();

    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "doctor") {
      return NextResponse.json(
        { success: false, message: "Khong dung quyen doctor" },
        { status: 403 }
      );
    }

    let body: CreateScheduleBody;
    try {
      body = (await req.json()) as CreateScheduleBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const {
      work_date,
      start_time,
      end_time,
      slot_duration,
      service_id,
      price,
      room,
      max_patients,
    } = body;

    const doctor_id = await getDoctorProfileId(authUser.id);

    if (!doctor_id) {
      return NextResponse.json(
        { success: false, message: "Doctor profile khong ton tai" },
        { status: 404 }
      );
    }

    const normalizedWorkDate = normalizeDateOnly(work_date);

    if (!normalizedWorkDate || !start_time || !end_time || !slot_duration || !service_id) {
      return NextResponse.json(
        { success: false, message: "Thieu du lieu" },
        { status: 400 }
      );
    }

    if (start_time >= end_time) {
      return NextResponse.json(
        { success: false, message: "Thoi gian khong hop le" },
        { status: 400 }
      );
    }

    // Tu 1 khoang gio -> cat ra nhieu slot nho.
    const slots = generateSlots(start_time, end_time, slot_duration);
    if (slots.length === 0) {
      return NextResponse.json(
        { success: false, message: "Khong tao duoc slot" },
        { status: 400 }
      );
    }

    // Dung trảnsaction de insert loat slot an toan.
    await connection.beginTransaction();

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
      [doctor_id, service_id]
    );

    if (doctorServiceRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Service khong thuoc doctor nay" },
        { status: 400 }
      );
    }

    // Chuyen mang slot thanh dữ liệu insert bulk.
    const values: unknown[][] = slots.map((slot) => [
      doctor_id,
      service_id,
      normalizedWorkDate,
      slot.start_time,
      slot.end_time,
      room ?? null,
      price,
      max_patients ?? 1,
    ]);

    // Insert nhieu dong cung luc (nhanh hon insert tung dong).
    await connection.query(
      `INSERT INTO doctor_schedule_slots
      (doctor_id, service_id, work_date, start_time, end_time, room, price, max_patients)
      VALUES ?`,
      [values]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Tao lich kham thanh cong",
    });
  } catch (error) {
    await connection.rollback();

    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { success: false, message: "Trung gio da ton tai" },
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
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
