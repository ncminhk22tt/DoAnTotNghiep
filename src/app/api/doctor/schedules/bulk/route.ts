import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";
import { ensureScheduleClosedStatus } from "@/lib/scheduleSchema";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";

type SlotStatus = "available" | "full" | "closed";

type BulkUpdateBody = {
  service_id?: unknown;
  work_date?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  update_service_id?: unknown;
  update_work_date?: unknown;
  price?: unknown;
  max_patients?: unknown;
  room?: unknown;
  status?: unknown;
};

interface DoctorServiceRow extends RowDataPacket {
  service_id: number;
}

interface MaxBookedRow extends RowDataPacket {
  max_booked: number | null;
}

function normalizeTime(value: string) {
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

// PATCH /api/doctor/schedules/bulk
// Cap nhat hang loat slot theo service cua doctor hien tai.
export async function PATCH(req: NextRequest) {
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

    const doctorId = await getDoctorProfileId(authUser.id);
    if (!doctorId) {
      return NextResponse.json(
        { success: false, message: "Doctor profile khong ton tai" },
        { status: 404 }
      );
    }

    let body: BulkUpdateBody;
    try {
      body = (await req.json()) as BulkUpdateBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const serviceId = typeof body.service_id === "number" ? body.service_id : Number.NaN;
    const workDate = typeof body.work_date === "string" ? body.work_date.trim() : "";
    const startTimeRaw = typeof body.start_time === "string" ? body.start_time : "";
    const endTimeRaw = typeof body.end_time === "string" ? body.end_time : "";
    const startTime = startTimeRaw ? normalizeTime(startTimeRaw) : null;
    const endTime = endTimeRaw ? normalizeTime(endTimeRaw) : null;
    const updateServiceId =
      typeof body.update_service_id === "number" ? body.update_service_id : null;
    const updateWorkDate =
      typeof body.update_work_date === "string" ? body.update_work_date.trim() : "";
    const price = typeof body.price === "number" ? body.price : Number.NaN;
    const maxPatients = typeof body.max_patients === "number" ? body.max_patients : Number.NaN;
    const room = typeof body.room === "string" ? body.room.trim() : "";
    const requestedStatus =
      typeof body.status === "string" && ["available", "full", "closed"].includes(body.status)
        ? (body.status as SlotStatus)
        : null;

    if (
      Number.isNaN(serviceId) ||
      serviceId <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(workDate) ||
      Number.isNaN(price) ||
      price < 0
    ) {
      return NextResponse.json(
        { success: false, message: "Du lieu cap nhat khong hop le (thieu dich vu hoac ngay)" },
        { status: 400 }
      );
    }

    if (!Number.isInteger(maxPatients) || maxPatients <= 0) {
      return NextResponse.json(
        { success: false, message: "So benh nhan toi da phai la so nguyen duong" },
        { status: 400 }
      );
    }
    if ((startTimeRaw && !endTimeRaw) || (!startTimeRaw && endTimeRaw)) {
      return NextResponse.json(
        { success: false, message: "Can chon day du gio bat dau va gio ket thuc" },
        { status: 400 }
      );
    }
    if ((startTimeRaw && !startTime) || (endTimeRaw && !endTime)) {
      return NextResponse.json(
        { success: false, message: "Gio ap dung khong hop le" },
        { status: 400 }
      );
    }
    if (startTime && endTime && startTime >= endTime) {
      return NextResponse.json(
        { success: false, message: "Khoang gio ap dung khong hop le" },
        { status: 400 }
      );
    }
    if (updateServiceId !== null && (!Number.isInteger(updateServiceId) || updateServiceId <= 0)) {
      return NextResponse.json(
        { success: false, message: "Dich vu moi khong hop le" },
        { status: 400 }
      );
    }
    if (updateWorkDate && !/^\d{4}-\d{2}-\d{2}$/.test(updateWorkDate)) {
      return NextResponse.json(
        { success: false, message: "Ngay moi khong hop le" },
        { status: 400 }
      );
    }

    const timeFilterSql = startTime && endTime ? " AND start_time >= ? AND end_time <= ?" : "";
    const timeFilterParams = startTime && endTime ? [startTime, endTime] : [];

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
      [doctorId, serviceId]
    );

    if (doctorServiceRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Service khong thuoc doctor nay" },
        { status: 400 }
      );
    }

    const targetServiceId = updateServiceId ?? serviceId;
    if (updateServiceId !== null) {
      const [targetServiceRows] = await connection.execute<DoctorServiceRow[]>(
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
        [doctorId, targetServiceId]
      );

      if (targetServiceRows.length === 0) {
        await connection.rollback();
        return NextResponse.json(
          { success: false, message: "Dich vu moi khong thuoc doctor nay" },
          { status: 400 }
        );
      }
    }

    const targetWorkDate = updateWorkDate || workDate;

    const [maxBookedRows] = await connection.execute<MaxBookedRow[]>(
      `SELECT MAX(booked_count) AS max_booked
       FROM doctor_schedule_slots
       WHERE doctor_id = ? AND service_id = ? AND work_date = ?${timeFilterSql}`,
      [doctorId, serviceId, workDate, ...timeFilterParams]
    );

    const maxBooked = Number(maxBookedRows[0]?.max_booked ?? 0);
    if (maxPatients < maxBooked) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "So benh nhan toi da khong duoc nho hon slot da dat" },
        { status: 400 }
      );
    }

    if (requestedStatus) {
      await connection.execute(
        `UPDATE doctor_schedule_slots
         SET service_id = ?, work_date = ?, price = ?, max_patients = ?, room = ?, status = ?
         WHERE doctor_id = ? AND service_id = ? AND work_date = ?${timeFilterSql}`,
        [
          targetServiceId,
          targetWorkDate,
          price,
          maxPatients,
          room || null,
          requestedStatus,
          doctorId,
          serviceId,
          workDate,
          ...timeFilterParams,
        ]
      );
    } else {
      await connection.execute(
        `UPDATE doctor_schedule_slots
         SET service_id = ?, work_date = ?, price = ?, max_patients = ?, room = ?,
             status = CASE
               WHEN status = 'closed' THEN 'closed'
               WHEN booked_count >= ? THEN 'full'
               ELSE 'available'
             END
         WHERE doctor_id = ? AND service_id = ? AND work_date = ?${timeFilterSql}`,
        [
          targetServiceId,
          targetWorkDate,
          price,
          maxPatients,
          room || null,
          maxPatients,
          doctorId,
          serviceId,
          workDate,
          ...timeFilterParams,
        ]
      );
    }

    const [affectedRowsResult] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM doctor_schedule_slots
       WHERE doctor_id = ? AND service_id = ? AND work_date = ?${timeFilterSql}`,
      [doctorId, serviceId, workDate, ...timeFilterParams]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Cap nhat hang loat theo dich vu thanh cong",
      data: {
        service_id: serviceId,
        work_date: workDate,
        updated_service_id: targetServiceId,
        updated_work_date: targetWorkDate,
        start_time: startTime,
        end_time: endTime,
        total_slots: Number(affectedRowsResult[0]?.total ?? 0),
      },
    });
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { success: false, message: "Trung gio da ton tai o ngay moi" },
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
