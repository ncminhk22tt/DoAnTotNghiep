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
  slot_duration?: unknown;
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
        { success: false, message: "Không đúng quyền bác sĩ" },
        { status: 403 }
      );
    }

    const doctorId = await getDoctorProfileId(authUser.id);
    if (!doctorId) {
      return NextResponse.json(
        { success: false, message: "Hồ sơ bác sĩ không tồn tại" },
        { status: 404 }
      );
    }

    let body: BulkUpdateBody;
    try {
      body = (await req.json()) as BulkUpdateBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON không hợp lệ" },
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
    const slotDuration = typeof body.slot_duration === "number" ? body.slot_duration : null;
    const price = typeof body.price === "number" ? body.price : Number.NaN;
    const hasMaxPatients = typeof body.max_patients === "number";
    const maxPatients = hasMaxPatients ? (body.max_patients as number) : null;
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
        { success: false, message: "Dữ liệu cập nhật không hợp lệ (thiếu dịch vụ hoặc ngày)" },
        { status: 400 }
      );
    }

    if ((startTimeRaw && !endTimeRaw) || (!startTimeRaw && endTimeRaw)) {
      return NextResponse.json(
        { success: false, message: "Cần chọn đầy đủ giờ bắt đầu và giờ kết thúc" },
        { status: 400 }
      );
    }
    if ((startTimeRaw && !startTime) || (endTimeRaw && !endTime)) {
      return NextResponse.json(
        { success: false, message: "Giờ áp dụng không hợp lệ" },
        { status: 400 }
      );
    }
    if (startTime && endTime && startTime >= endTime) {
      return NextResponse.json(
        { success: false, message: "Khoảng giờ áp dụng không hợp lệ" },
        { status: 400 }
      );
    }
    if (updateServiceId !== null && (!Number.isInteger(updateServiceId) || updateServiceId <= 0)) {
      return NextResponse.json(
        { success: false, message: "Dịch vụ mới không hợp lệ" },
        { status: 400 }
      );
    }
    if (updateWorkDate && !/^\d{4}-\d{2}-\d{2}$/.test(updateWorkDate)) {
      return NextResponse.json(
        { success: false, message: "Ngày mới không hợp lệ" },
        { status: 400 }
      );
    }
    if (slotDuration !== null && (!Number.isInteger(slotDuration) || slotDuration <= 0)) {
      return NextResponse.json(
        { success: false, message: "Độ dài slot không hợp lệ" },
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
        { success: false, message: "Dịch vụ không thuộc bác sĩ này" },
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
          { success: false, message: "Dịch vụ mới không thuộc bác sĩ này" },
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
    if (hasMaxPatients && (!Number.isInteger(maxPatients) || (maxPatients ?? 0) <= 0)) {
      return NextResponse.json(
        { success: false, message: "Số bệnh nhân tối đa phải là số nguyên dương" },
        { status: 400 }
      );
    }

    if (hasMaxPatients && maxPatients! < maxBooked) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Số bệnh nhân tối đa không được nhỏ hơn slot đã đặt" },
        { status: 400 }
      );
    }

    const setClauses = ["service_id = ?", "work_date = ?", "price = ?"];
    const params: Array<string | number | null> = [targetServiceId, targetWorkDate, price];

    if (hasMaxPatients) {
      setClauses.push("max_patients = ?");
      params.push(maxPatients);
    }

    setClauses.push("room = ?");
    params.push(room || null);

    if (requestedStatus === "closed") {
      setClauses.push("status = ?");
      params.push(requestedStatus);
    } else {
      setClauses.push(
        "status = CASE WHEN status = 'closed' THEN 'closed' WHEN booked_count >= 1 THEN 'full' ELSE 'available' END"
      );
    }

    await connection.execute(
      `UPDATE doctor_schedule_slots
       SET ${setClauses.join(", ")}
       WHERE doctor_id = ? AND service_id = ? AND work_date = ?${timeFilterSql}`,
      [...params, doctorId, serviceId, workDate, ...timeFilterParams]
    );

    const [affectedRowsResult] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM doctor_schedule_slots
       WHERE doctor_id = ? AND service_id = ? AND work_date = ?${timeFilterSql}`,
      [doctorId, serviceId, workDate, ...timeFilterParams]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Cập nhật hàng loạt theo dịch vụ thành công",
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
        { success: false, message: "Trùng giờ đã tồn tại ở ngày mới" },
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
