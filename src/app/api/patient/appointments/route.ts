import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { hasTableColumn } from "@/lib/db";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";
import { notifyWaitingPatientForSlot } from "@/lib/waitlistService";
import { getMinutesUntilClinicSlot, isClinicSlotInPast } from "@/lib/clinicTime";
import { evaluatePatientRiskAndNotifyAdmins } from "@/lib/userRiskMonitor";

// FILE HỌC NGHIỆP VỤ ĐẶT/HỦY LỊCH:
// - GET: xem danh sach lich cua patient.
// - POST: dat lich (co trảnsaction + lock slot).
// - PATCH: huy lich (co trảnsaction + giam booked_count).

interface SlotRow extends RowDataPacket {
  id: number;
  doctor_id: number;
  service_id: number | null;
  booked_count: number;
  max_patients: number;
  work_date: string;
  start_time: string;
  end_time: string;
  status: "available" | "full" | "closed" | "locked";
}

interface DoctorUserRow extends RowDataPacket {
  user_id: number;
  full_name: string | null;
}

interface ServiceRow extends RowDataPacket {
  name: string | null;
}

interface AppointmentRow extends RowDataPacket {
  id: number;
  user_id: number;
  slot_id: number;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
}

interface PatientAppointmentListRow extends RowDataPacket {
  id: number;
  user_id: number;
  slot_id: number | null;
  doctor_id: number | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  note: string | null;
  admin_note: string | null;
  created_at: string;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  price: number | null;
  service_id: number | null;
  service_name: string | null;
  doctor_name: string | null;
  doctor_code: string | null;
  doctor_phone: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
}

function formatDatePart(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return "";
}

function formatTimePart(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 5);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(11, 16);
  }
  return "";
}

async function hasAppointmentWaitlistTable(connection: Awaited<ReturnType<typeof db.getConnection>>) {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SHOW TABLES LIKE 'appointment_waitlist'"
  );
  return rows.length > 0;
}

async function hasTable(connection: Awaited<ReturnType<typeof db.getConnection>>, tableName: string) {
  const [rows] = await connection.query<RowDataPacket[]>("SHOW TABLES LIKE ?", [tableName]);
  return rows.length > 0;
}

export async function GET(req: NextRequest) {
  try {
    const hasAdminNoteColumn = await hasTableColumn("appointments", "admin_note");
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi patient moi duoc xem lich" },
        { status: 403 }
      );
    }

    const status = req.nextUrl.searchParams.get("status");
    const date = req.nextUrl.searchParams.get("date");

    let sql = `SELECT a.id, a.user_id, a.slot_id, a.doctor_id, a.status, a.note, ${hasAdminNoteColumn ? "a.admin_note" : "NULL AS admin_note"}, a.created_at,
                      DATE_FORMAT(s.work_date, '%Y-%m-%d') AS work_date,
                      TIME_FORMAT(s.start_time, '%H:%i:%s') AS start_time,
                      TIME_FORMAT(s.end_time, '%H:%i:%s') AS end_time,
                      s.room, s.price, s.service_id,
                      sv.name AS service_name,
                      u.full_name AS doctor_name,
                      d.doctor_code AS doctor_code,
                      u.phone AS doctor_phone,
                      sp.id AS specialty_id,
                      sp.name AS specialty_name
               FROM appointments a
               LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
               LEFT JOIN doctors d ON d.id = COALESCE(a.doctor_id, s.doctor_id)
               LEFT JOIN users u ON u.id = d.user_id
               LEFT JOIN services sv ON sv.id = s.service_id
               LEFT JOIN specialties sp ON sp.id = COALESCE(sv.specialty_id, d.specialty_id)
               WHERE a.user_id = ?`;
    const params: Array<string | number> = [authUser.id];

    if (status) {
      if (status === "pending_confirmed") {
        sql += " AND a.status IN ('pending','confirmed')";
      } else if (["pending", "confirmed", "completed", "cancelled", "no_show"].includes(status)) {
        sql += " AND a.status = ?";
        params.push(status);
      }
    }

    if (date) {
      sql += " AND s.work_date = ?";
      params.push(date);
    }

    sql += " ORDER BY a.created_at DESC, a.id DESC";

    const [rows] = await db.execute<PatientAppointmentListRow[]>(sql, params);

    return NextResponse.json({
      success: true,
      message: "Lay danh sach lich hen thanh cong",
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
  let transactionStarted = false;

  try {
    const hasScheduleIdColumn = await hasTableColumn("appointments", "schedule_id");
    const hasAppointmentDayColumn = await hasTableColumn("appointments", "appointment_day");
    const hasSlotServiceIdColumn = await hasTableColumn("doctor_schedule_slots", "service_id");
    const waitlistTableReady = await hasAppointmentWaitlistTable(connection);
    const notificationsTableReady = await hasTable(connection, "notifications");
    const notificationsHasIsReadColumn = notificationsTableReady
      ? await hasTableColumn("notifications", "is_read")
      : false;
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi patient moi duoc dat lich" },
        { status: 403 }
      );
    }

    let payload: { slot_id?: unknown; note?: unknown };
    try {
      payload = (await req.json()) as { slot_id?: unknown; note?: unknown };
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const slot_id = typeof payload.slot_id === "number" ? payload.slot_id : Number.NaN;
    const note = typeof payload.note === "string" ? payload.note.trim() : null;
    const patient_id = authUser.id;

    if (!slot_id || Number.isNaN(slot_id) || slot_id <= 0) {
      return NextResponse.json(
        { success: false, message: "slot_id khong hop le" },
        { status: 400 }
      );
    }

    // Bat dau trảnsaction de trảnh race condition khi nhieu nguoi dat cung luc.
    await connection.beginTransaction();
    transactionStarted = true;
    transactionStarted = true;

    // FOR UPDATE de khoa dong slot hien tai trong trảnsaction.
    const [slotRows] = await connection.execute<SlotRow[]>(
      `SELECT id, doctor_id, ${hasSlotServiceIdColumn ? "service_id" : "NULL AS service_id"}, booked_count, max_patients, work_date, start_time, end_time, status
       FROM doctor_schedule_slots
       WHERE id = ?
       FOR UPDATE`,
      [slot_id]
    );

    if (slotRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot khong ton tai" },
        { status: 404 }
      );
    }

    const slot = slotRows[0];

    if (slot.status === "closed") {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot da dong" },
        { status: 400 }
      );
    }

    if (slot.status === "full" || slot.booked_count >= 1) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot da day" },
        { status: 400 }
      );
    }

    const [activeAppointmentRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id
       FROM appointments
       WHERE slot_id = ?
         AND status IN ('pending', 'confirmed')
       LIMIT 1
       FOR UPDATE`,
      [slot_id]
    );

    if (activeAppointmentRows.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot nay da co lich kham" },
        { status: 400 }
      );
    }

    const isPast = isClinicSlotInPast(slot.work_date, slot.start_time);
    const minutesUntilSlot = getMinutesUntilClinicSlot(slot.work_date, slot.start_time);
    if (isPast || minutesUntilSlot === null || minutesUntilSlot <= 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot da qua" },
        { status: 400 }
      );
    }

    // Kiem tra trung ngay: patient không duoc co 2 lich active trong cung 1 ngay.
    const [existingSameDay] = await connection.execute<RowDataPacket[]>(
      `SELECT a.id
       FROM appointments a
       JOIN doctor_schedule_slots s ON a.slot_id = s.id
       WHERE a.user_id = ?
         AND s.work_date = ?
         AND a.status IN ('pending','confirmed')
       LIMIT 1
       FOR UPDATE`,
      [patient_id, slot.work_date]
    );

    if (existingSameDay.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Bạn chỉ được đặt 1 lịch khám trong cùng một ngày" },
        { status: 400 }
      );
    }

    // Kiem tra trung gio: patient không duoc co 2 lich chong len nhau.
    const [existing] = await connection.execute<RowDataPacket[]>(
      `SELECT a.id
       FROM appointments a
       JOIN doctor_schedule_slots s ON a.slot_id = s.id
       WHERE a.user_id = ?
         AND s.work_date = ?
         AND (s.start_time < ? AND s.end_time > ?)
         AND a.status IN ('pending','confirmed')`,
      [patient_id, slot.work_date, slot.end_time, slot.start_time]
    );

    if (existing.length > 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Bạn đã có giờ trùng lịch" },
        { status: 400 }
      );
    }

    // Tang so nguoi da dat trong slot.
    await connection.execute<ResultSetHeader>(
      `UPDATE doctor_schedule_slots
       SET booked_count = booked_count + 1
       WHERE id = ?`,
      [slot_id]
    );

    if (slot.booked_count + 1 >= 1) {
      await connection.execute(
        `UPDATE doctor_schedule_slots
         SET status = 'full'
         WHERE id = ?`,
        [slot_id]
      );
    }

    // Tao lịch hẹn.
    if (hasScheduleIdColumn && hasAppointmentDayColumn) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO appointments (user_id, slot_id, doctor_id, schedule_id, appointment_day, status, note, created_at)
         VALUES (?, ?, ?, ?, ?, 'confirmed', ?, NOW())`,
        [patient_id, slot_id, slot.doctor_id, slot_id, slot.work_date, note]
      );
    } else if (hasScheduleIdColumn) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO appointments (user_id, slot_id, doctor_id, schedule_id, status, note, created_at)
         VALUES (?, ?, ?, ?, 'confirmed', ?, NOW())`,
        [patient_id, slot_id, slot.doctor_id, slot_id, note]
      );
    } else if (hasAppointmentDayColumn) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO appointments (user_id, slot_id, doctor_id, appointment_day, status, note, created_at)
         VALUES (?, ?, ?, ?, 'confirmed', ?, NOW())`,
        [patient_id, slot_id, slot.doctor_id, slot.work_date, note]
      );
    } else {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO appointments (user_id, slot_id, doctor_id, status, note, created_at)
         VALUES (?, ?, ?, 'confirmed', ?, NOW())`,
        [patient_id, slot_id, slot.doctor_id, note]
      );
    }

    if (waitlistTableReady) {
      await connection.execute<ResultSetHeader>(
        `UPDATE appointment_waitlist
         SET status = 'booked', updated_at = NOW()
         WHERE user_id = ? AND slot_id = ? AND status IN ('waiting','notified')`,
        [patient_id, slot_id]
      );
    }

    const [doctorRows] = await connection.execute<DoctorUserRow[]>(
      `SELECT d.user_id, u.full_name
       FROM doctors d
       LEFT JOIN users u ON u.id = d.user_id
       WHERE d.id = ? LIMIT 1`,
      [slot.doctor_id]
    );
    const doctorUserId = doctorRows[0]?.user_id ?? null;
    const doctorName = doctorRows[0]?.full_name || "BS. Chua cap nhat";
    const [serviceRows] = await connection.execute<ServiceRow[]>(
      "SELECT name FROM services WHERE id = ? LIMIT 1",
      [slot.service_id]
    );
    const serviceName = serviceRows[0]?.name || "Kham tong quat";
    const noteText = note || "Khong co";
    const scheduleDate = formatDatePart(slot.work_date);
    const scheduleStart = formatTimePart(slot.start_time);
    const scheduleEnd = formatTimePart(slot.end_time);
    const patientBookingMessage = [
      serviceName,
      "Chua kham",
      `Lich kham: ${scheduleDate} (${scheduleStart} - ${scheduleEnd})`,
      `Bac si: ${doctorName}`,
      `Ghi chu dat lich: ${noteText}`,
    ].join("\n");

    await connection.commit();

    if (notificationsTableReady) {
      void (async () => {
        try {
          const actionUrlReady = await getNotificationActionUrlReady();
          const patientActionUrl = "/patient/appointments";
          const doctorActionUrl = "/doctor/appointments";

          if (actionUrlReady && notificationsHasIsReadColumn) {
            await db.execute(
              `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
               VALUES (?, ?, ?, false, NOW())`,
              [patient_id, patientBookingMessage, patientActionUrl]
            );

            if (doctorUserId) {
              await db.execute(
                `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
                 VALUES (?, ?, ?, false, NOW())`,
                [doctorUserId, "Ban co lich hen moi", doctorActionUrl]
              );
            }
          } else if (actionUrlReady && !notificationsHasIsReadColumn) {
            await db.execute(
              `INSERT INTO notifications (user_id, message, action_url, created_at)
               VALUES (?, ?, ?, NOW())`,
              [patient_id, patientBookingMessage, patientActionUrl]
            );

            if (doctorUserId) {
              await db.execute(
                `INSERT INTO notifications (user_id, message, action_url, created_at)
                 VALUES (?, ?, ?, NOW())`,
                [doctorUserId, "Ban co lich hen moi", doctorActionUrl]
              );
            }
          } else if (!actionUrlReady && notificationsHasIsReadColumn) {
            await db.execute(
              `INSERT INTO notifications (user_id, message, is_read, created_at)
               VALUES (?, ?, false, NOW())`,
              [patient_id, patientBookingMessage]
            );

            if (doctorUserId) {
              await db.execute(
                `INSERT INTO notifications (user_id, message, is_read, created_at)
                 VALUES (?, ?, false, NOW())`,
                [doctorUserId, "Ban co lich hen moi"]
              );
            }
          } else {
            await db.execute(
              `INSERT INTO notifications (user_id, message, created_at)
               VALUES (?, ?, NOW())`,
              [patient_id, patientBookingMessage]
            );

            if (doctorUserId) {
              await db.execute(
                `INSERT INTO notifications (user_id, message, created_at)
                 VALUES (?, ?, NOW())`,
                [doctorUserId, "Ban co lich hen moi"]
              );
            }
          }
        } catch (notificationError) {
          console.error("Failed to create booking notifications:", notificationError);
        }
      })();
    }

    return NextResponse.json({
      success: true,
      message: "Dat lich thanh cong",
    });
  } catch (error) {
    console.error("POST /api/patient/appointments failed:", error);
    if (transactionStarted) {
      await connection.rollback();
    }
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { success: false, message: "Slot nay da co lich kham" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        success: false,
        message:
          process.env.NODE_ENV === "production"
            ? "Loi server"
            : `Loi server: ${error instanceof Error ? error.message : "Unknown server error"}`,
      },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}

export async function PATCH(req: NextRequest) {
  const connection = await db.getConnection();
  let transactionStarted = false;

  try {
    const hasAdminNoteColumn = await hasTableColumn("appointments", "admin_note");
    const hasSlotServiceIdColumn = await hasTableColumn("doctor_schedule_slots", "service_id");
    const waitlistTableReady = await hasAppointmentWaitlistTable(connection);
    const notificationsTableReady = await hasTable(connection, "notifications");
    const notificationsHasIsReadColumn = notificationsTableReady
      ? await hasTableColumn("notifications", "is_read")
      : false;
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi patient moi duoc huy lich" },
        { status: 403 }
      );
    }

    let payload: { appointment_id?: unknown; cancel_reason?: unknown };
    try {
      payload = (await req.json()) as { appointment_id?: unknown; cancel_reason?: unknown };
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const appointment_id =
      typeof payload.appointment_id === "number" ? payload.appointment_id : Number.NaN;
    const cancelReason =
      typeof payload.cancel_reason === "string" ? payload.cancel_reason.trim() : "";

    if (!appointment_id || Number.isNaN(appointment_id) || appointment_id <= 0) {
      return NextResponse.json(
        { success: false, message: "appointment_id khong hop le" },
        { status: 400 }
      );
    }
    if (!cancelReason) {
      return NextResponse.json(
        { success: false, message: "Vui long nhap ly do huy lich" },
        { status: 400 }
      );
    }

    const patient_id = authUser.id;

    // Huy lich cung dung trảnsaction de trảnh sai booked_count.
    await connection.beginTransaction();
    transactionStarted = true;

    const [appointmentRows] = await connection.execute<AppointmentRow[]>(
      `SELECT id, user_id, slot_id, status
       FROM appointments
       WHERE id = ?
       FOR UPDATE`,
      [appointment_id]
    );

    if (appointmentRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen khong ton tai" },
        { status: 404 }
      );
    }

    const appointment = appointmentRows[0];

    if (appointment.user_id !== patient_id) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Khong du quyen huy lich nay" },
        { status: 403 }
      );
    }

    if (!['pending', 'confirmed'].includes(appointment.status)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chi huy duoc lich pending hoac confirmed" },
        { status: 400 }
      );
    }

    const [slotRows] = await connection.execute<SlotRow[]>(
      `SELECT id, doctor_id, ${hasSlotServiceIdColumn ? "service_id" : "NULL AS service_id"}, booked_count, max_patients, work_date, start_time, end_time, status
       FROM doctor_schedule_slots
       WHERE id = ?
       FOR UPDATE`,
      [appointment.slot_id]
    );

    if (slotRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Slot khong ton tai" },
        { status: 404 }
      );
    }

    const slot = slotRows[0];
    const cancelDeadlineMinutes = Number(process.env.PATIENT_CANCEL_DEADLINE_MINUTES) || 120;
    const minutesUntilSlot = getMinutesUntilClinicSlot(slot.work_date, slot.start_time);
    if (minutesUntilSlot === null || minutesUntilSlot < cancelDeadlineMinutes) {
      await connection.rollback();
      return NextResponse.json(
        {
          success: false,
          message: `Chỉ được hủy lịch trước ít nhất ${cancelDeadlineMinutes} phút so với giờ khám`,
        },
        { status: 400 }
      );
    }

    // Chuyen trảng thai lịch hẹn sang cancelled.
    await connection.execute<ResultSetHeader>(
      hasAdminNoteColumn
        ? `UPDATE appointments
           SET status = 'cancelled', admin_note = ?
           WHERE id = ?`
        : `UPDATE appointments
           SET status = 'cancelled'
           WHERE id = ?`,
      hasAdminNoteColumn ? [`[Benh nhan huy] ${cancelReason}`, appointment_id] : [appointment_id]
    );

    // Giam booked_count cua slot.
    await connection.execute<ResultSetHeader>(
      `UPDATE doctor_schedule_slots
       SET booked_count = GREATEST(booked_count - 1, 0)
       WHERE id = ?`,
      [appointment.slot_id]
    );

    const newBookedCount = Math.max(slot.booked_count - 1, 0);
    if (slot.status === "full" && newBookedCount < 1) {
      await connection.execute(
        `UPDATE doctor_schedule_slots
         SET status = 'available'
         WHERE id = ?`,
        [appointment.slot_id]
      );
    }

    if (waitlistTableReady && newBookedCount < 1) {
      await notifyWaitingPatientForSlot(connection, appointment.slot_id);
    }

    await connection.commit();

    if (notificationsTableReady) {
      void (async () => {
        try {
          const [doctorRows] = await db.execute<DoctorUserRow[]>(
            `SELECT d.user_id, u.full_name
             FROM doctors d
             LEFT JOIN users u ON u.id = d.user_id
             WHERE d.id = ? LIMIT 1`,
            [slot.doctor_id]
          );
          const doctorName = doctorRows[0]?.full_name || "BS. Chua cap nhat";
          const [serviceRows] = await db.execute<ServiceRow[]>(
            "SELECT name FROM services WHERE id = ? LIMIT 1",
            [slot.service_id]
          );
          const serviceName = serviceRows[0]?.name || "Kham tong quat";
          const cancelMessage = [
            serviceName,
            "Benh nhan huy",
            `Lich kham: ${formatDatePart(slot.work_date)} (${formatTimePart(slot.start_time)} - ${formatTimePart(slot.end_time)})`,
            `Bac si: ${doctorName}`,
            `Ly do huy: ${cancelReason}`,
          ].join("\n");
          const actionUrlReady = await getNotificationActionUrlReady();
          await db.execute<ResultSetHeader>(
            actionUrlReady && notificationsHasIsReadColumn
              ? `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
                 VALUES (?, ?, ?, false, NOW())`
              : actionUrlReady && !notificationsHasIsReadColumn
              ? `INSERT INTO notifications (user_id, message, action_url, created_at)
                 VALUES (?, ?, ?, NOW())`
              : !actionUrlReady && notificationsHasIsReadColumn
              ? `INSERT INTO notifications (user_id, message, is_read, created_at)
                 VALUES (?, ?, false, NOW())`
              : `INSERT INTO notifications (user_id, message, created_at)
                 VALUES (?, ?, NOW())`,
            actionUrlReady ? [patient_id, cancelMessage, "/patient/appointments"] : [patient_id, cancelMessage]
          );
        } catch (notificationError) {
          console.error("Failed to create patient-cancel notification:", notificationError);
        }
      })();
    }

    void (async () => {
      const riskConnection = await db.getConnection();
      try {
        await evaluatePatientRiskAndNotifyAdmins(riskConnection, patient_id);
      } catch (riskError) {
        console.error("Failed to evaluate patient risk after cancel:", riskError);
      } finally {
        riskConnection.release();
      }
    })();

    return NextResponse.json({
      success: true,
      message: "Huy lich thanh cong",
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    console.error("PATCH /api/patient/appointments failed:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          process.env.NODE_ENV === "production"
            ? "Loi server"
            : `Loi server: ${error instanceof Error ? error.message : "Unknown server error"}`,
      },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
