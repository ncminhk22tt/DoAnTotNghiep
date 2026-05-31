import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSlots } from "@/lib/generateSlots";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { RowDataPacket } from "mysql2";
import { ScheduleSlot } from "@/types/slot";
import { getDoctorProfileId } from "@/lib/doctorProfile";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";
import { ensureScheduleClosedStatus } from "@/lib/scheduleSchema";

// FILE HĂ„â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¡Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â»Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚Â¦Ă„â€Ă‚Â¢Ä‚Â¢Ă¢â‚¬ÂĂ‚Â¬Ä‚Â¢Ă¢â‚¬ÂĂ‚Â¢C LĂ„â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¡Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â»Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚ÂCH LÄ‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă‚Â¢Ä‚Â¢Ă¢â‚¬ÂĂ‚Â¬Ä‚â€Ă‚ÂÄ‚â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¢Ă„â€Ă‚Â¢Ä‚Â¢Ă¢â‚¬ÂĂ‚Â¬Ä‚â€Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¬M VIĂ„â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¡Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â»Ä‚â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¢Ă„â€Ă‚Â¢Ä‚Â¢Ă¢â€Â¬Ă‚ÂÄ‚â€Ă‚Â¬Ă„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â C CĂ„â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¡Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â»Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¦A DOCTOR:
// - GET: xem danh sach slot lich.
// - POST: tao hang loat slot tu 1 khoang thoi gian.

interface CreateScheduleBody {
  work_date: string;
  start_time: string;
  end_time: string;
  slot_duration: number;
  service_id: number;
  price: unknown;
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

function todayDateOnly(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nowTimeOnly(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function timeToMinutes(value: string): number {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return Number.NaN;
  }
  return hours * 60 + minutes;
}

// GET /api/doctor/schedules
// Xem danh sach slot cua doctor hien tai (co the filter theo date/status/service_id)
export async function GET(req: NextRequest) {
  try {
    await ensureScheduleClosedStatus();

    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "doctor") {
      return NextResponse.json(
        { success: false, message: "KhĂ„â€Ă‚Â´ng Ä‚â€Ă¢â‚¬ËœĂ„â€Ă‚Âºng quyÄ‚Â¡Ă‚Â»Ă‚Ân bĂ„â€Ă‚Â¡c sÄ‚â€Ă‚Â©" },
        { status: 403 }
      );
    }

    const doctorProfileId = await getDoctorProfileId(authUser.id);
    if (!doctorProfileId) {
      return NextResponse.json(
        { success: false, message: "HÄ‚Â¡Ă‚Â»Ă¢â‚¬Å“ sÄ‚â€ Ă‚Â¡ bĂ„â€Ă‚Â¡c sÄ‚â€Ă‚Â© khĂ„â€Ă‚Â´ng tÄ‚Â¡Ă‚Â»Ă¢â‚¬Å“n tÄ‚Â¡Ă‚ÂºĂ‚Â¡i" },
        { status: 404 }
      );
    }

    const date = req.nextUrl.searchParams.get("date");
    const status = req.nextUrl.searchParams.get("status");
    const serviceIdParam = req.nextUrl.searchParams.get("service_id");

    // SQL nen duoc ghep tung dieu kien de filter linh hoat.
    let sql =
      "SELECT dss.id, dss.doctor_id, dss.service_id, s.name AS service_name, DATE_FORMAT(dss.work_date, '%Y-%m-%d') AS work_date, dss.start_time, dss.end_time, dss.room, dss.price, dss.max_patients, dss.booked_count, dss.status FROM doctor_schedule_slots dss LEFT JOIN services s ON s.id = dss.service_id WHERE dss.doctor_id = ?";
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
          { success: false, message: "service_id khĂ„â€Ă‚Â´ng hÄ‚Â¡Ă‚Â»Ă‚Â£p lÄ‚Â¡Ă‚Â»Ă¢â‚¬Â¡" },
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
      message: "LÄ‚Â¡Ă‚ÂºĂ‚Â¥y lÄ‚Â¡Ă‚Â»Ă¢â‚¬Â¹ch khĂ„â€Ă‚Â¡m thĂ„â€Ă‚Â nh cĂ„â€Ă‚Â´ng",
      data,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "LÄ‚Â¡Ă‚Â»Ă¢â‚¬â€i server" },
      { status: 500 }
    );
  }
}

// POST /api/doctor/schedules
// Tao nhieu slot lĂ„â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¡Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â»Ä‚â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¢Ă„â€Ă‚Â¢Ä‚Â¢Ă¢â€Â¬Ă‚ÂÄ‚â€Ă‚Â¬Ă„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¹ch khÄ‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă‚Â¢Ä‚Â¢Ă¢â‚¬ÂĂ‚Â¬Ä‚â€Ă‚ÂÄ‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¡m trong 1 ca
export async function POST(req: NextRequest) {
  const connection = await db.getConnection();

  try {
    await ensureScheduleClosedStatus();

    const softDeleteReady = await getServiceSoftDeleteReady();

    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "doctor") {
      return NextResponse.json(
        { success: false, message: "KhĂ„â€Ă‚Â´ng Ä‚â€Ă¢â‚¬ËœĂ„â€Ă‚Âºng quyÄ‚Â¡Ă‚Â»Ă‚Ân bĂ„â€Ă‚Â¡c sÄ‚â€Ă‚Â©" },
        { status: 403 }
      );
    }

    let body: CreateScheduleBody;
    try {
      body = (await req.json()) as CreateScheduleBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khĂ„â€Ă‚Â´ng hÄ‚Â¡Ă‚Â»Ă‚Â£p lÄ‚Â¡Ă‚Â»Ă¢â‚¬Â¡" },
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
        { success: false, message: "HÄ‚Â¡Ă‚Â»Ă¢â‚¬Å“ sÄ‚â€ Ă‚Â¡ bĂ„â€Ă‚Â¡c sÄ‚â€Ă‚Â© khĂ„â€Ă‚Â´ng tÄ‚Â¡Ă‚Â»Ă¢â‚¬Å“n tÄ‚Â¡Ă‚ÂºĂ‚Â¡i" },
        { status: 404 }
      );
    }

    const normalizedWorkDate = normalizeDateOnly(work_date);
    const normalizedPrice =
      typeof price === "number" ? price : typeof price === "string" ? Number(price.trim()) : Number.NaN;
    const normalizedRoom = typeof room === "string" ? room.trim() : "";
    const today = todayDateOnly();
    const now = nowTimeOnly();

    if (!normalizedWorkDate || !start_time || !end_time || !slot_duration || !service_id) {
      return NextResponse.json(
        { success: false, message: "ThiÄ‚Â¡Ă‚ÂºĂ‚Â¿u dÄ‚Â¡Ă‚Â»Ă‚Â¯ liÄ‚Â¡Ă‚Â»Ă¢â‚¬Â¡u" },
        { status: 400 }
      );
    }
    if (price === undefined || price === null || (typeof price === "string" && !price.trim())) {
      return NextResponse.json(
        { success: false, message: "Vui long nhap gia kham" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) {
      return NextResponse.json(
        { success: false, message: "Gia kham khong hop le" },
        { status: 400 }
      );
    }
    if (!normalizedRoom) {
      return NextResponse.json(
        { success: false, message: "Vui long nhap phong kham" },
        { status: 400 }
      );
    }
    if (normalizedWorkDate < today) {
      return NextResponse.json(
        { success: false, message: "KhĂ´ng thá»ƒ táº¡o lá»‹ch cho ngĂ y Ä‘Ă£ qua" },
        { status: 400 }
      );
    }
    if (normalizedWorkDate === today && start_time <= now) {
      return NextResponse.json(
        { success: false, message: "KhĂ´ng thá»ƒ táº¡o lá»‹ch cho giá» Ä‘Ă£ qua trong ngĂ y hĂ´m nay" },
        { status: 400 }
      );
    }

    const startMinutes = timeToMinutes(start_time);
    const endMinutes = timeToMinutes(end_time);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes - startMinutes < slot_duration) {
      return NextResponse.json(
        { success: false, message: "Khoang gio phai dai hon do dai slot" },
        { status: 400 }
      );
    }

    if (start_time >= end_time) {
      return NextResponse.json(
        { success: false, message: "ThÄ‚Â¡Ă‚Â»Ă‚Âi gian khĂ„â€Ă‚Â´ng hÄ‚Â¡Ă‚Â»Ă‚Â£p lÄ‚Â¡Ă‚Â»Ă¢â‚¬Â¡" },
        { status: 400 }
      );
    }

    // Tu 1 khoang gio -> cat ra nhieu slot nho.
    const slots = generateSlots(start_time, end_time, slot_duration);
    if (slots.length === 0) {
      return NextResponse.json(
        { success: false, message: "KhĂ„â€Ă‚Â´ng tÄ‚Â¡Ă‚ÂºĂ‚Â¡o Ä‚â€Ă¢â‚¬ËœÄ‚â€ Ă‚Â°Ä‚Â¡Ă‚Â»Ă‚Â£c slot" },
        { status: 400 }
      );
    }

    // Dung trĂ„â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¡Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚ÂºÄ‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â£nsaction de insert loat slot an toan.
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
        { success: false, message: "DÄ‚Â¡Ă‚Â»Ă¢â‚¬Â¹ch vÄ‚Â¡Ă‚Â»Ă‚Â¥ khĂ„â€Ă‚Â´ng thuÄ‚Â¡Ă‚Â»Ă¢â€Â¢c bĂ„â€Ă‚Â¡c sÄ‚â€Ă‚Â© nĂ„â€Ă‚Â y" },
        { status: 400 }
      );
    }

    // Chuyen mang slot thanh dĂ„â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¡Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â»Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¯ liĂ„â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¡Ä‚â€Ă¢â‚¬ÂÄ‚Â¢Ă¢â€Â¬Ă‚ÂĂ„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â»Ä‚â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¢Ă„â€Ă‚Â¢Ä‚Â¢Ă¢â€Â¬Ă‚ÂÄ‚â€Ă‚Â¬Ă„â€Ă¢â‚¬ÂÄ‚â€Ă‚Â¡u insert bulk.
    const values: unknown[][] = slots.map((slot) => [
      doctor_id,
      service_id,
      normalizedWorkDate,
      slot.start_time,
      slot.end_time,
      normalizedRoom,
      normalizedPrice,
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
      message: "TÄ‚Â¡Ă‚ÂºĂ‚Â¡o lÄ‚Â¡Ă‚Â»Ă¢â‚¬Â¹ch khĂ„â€Ă‚Â¡m thĂ„â€Ă‚Â nh cĂ„â€Ă‚Â´ng",
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
      { success: false, message: "LÄ‚Â¡Ă‚Â»Ă¢â‚¬â€i server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
