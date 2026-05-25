import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { sendEmailNotification } from "@/lib/notificationService";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";

interface DueAppointmentRow extends RowDataPacket {
  appointment_id: number;
  user_id: number;
  patient_name: string;
  patient_email: string | null;
  doctor_name: string | null;
  work_date: string;
  start_time: string;
}

// POST /api/system/reminders/appointments
// Cron job: nhac lich hen truoc 2 gio cho benh nhan (1 lan / lich hen)
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, message: "Khong co quyen" }, { status: 401 });
  }

  const connection = await db.getConnection();
  try {
    const actionUrlReady = await getNotificationActionUrlReady();
    await connection.beginTransaction();

    const [rows] = await connection.execute<DueAppointmentRow[]>(
      `SELECT a.id AS appointment_id,
              a.user_id,
              p.full_name AS patient_name,
              p.email AS patient_email,
              duser.full_name AS doctor_name,
              s.work_date,
              s.start_time
       FROM appointments a
       JOIN users p ON p.id = a.user_id
       JOIN doctor_schedule_slots s ON s.id = a.slot_id
       LEFT JOIN doctors d ON d.id = COALESCE(a.doctor_id, s.doctor_id)
       LEFT JOIN users duser ON duser.id = d.user_id
       WHERE a.status IN ('pending', 'confirmed')
         AND TIMESTAMP(s.work_date, s.start_time) BETWEEN DATE_ADD(NOW(), INTERVAL 1 HOUR 45 MINUTE)
                                                      AND DATE_ADD(NOW(), INTERVAL 2 HOUR 15 MINUTE)
         AND NOT EXISTS (
           SELECT 1
           FROM appointment_reminders ar
           WHERE ar.appointment_id = a.id
             AND ar.reminder_type = 'before_visit'
         )`
    );

    const emailQueue: Array<{ to: string; subject: string; content: string }> = [];

    for (const row of rows) {
      const message = `Nhac lich truoc 2 gio: Lich kham #${row.appointment_id} luc ${row.start_time} ngay ${row.work_date} voi bac si ${row.doctor_name ?? "dang cap nhat"}.`;

      await connection.execute<ResultSetHeader>(
        actionUrlReady
          ? `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
             VALUES (?, ?, ?, false, NOW())`
          : `INSERT INTO notifications (user_id, message, is_read, created_at)
             VALUES (?, ?, false, NOW())`,
        actionUrlReady ? [row.user_id, message, "/patient/appointments"] : [row.user_id, message]
      );

      await connection.execute<ResultSetHeader>(
        `INSERT INTO appointment_reminders (appointment_id, reminder_type, reminded_at)
         VALUES (?, 'before_visit', NOW())`,
        [row.appointment_id]
      );

      if (row.patient_email) {
        emailQueue.push({
          to: row.patient_email,
          subject: "Nhac lich kham benh truoc 2 gio",
          content: message,
        });
      }
    }

    await connection.commit();

    for (const email of emailQueue) {
      await sendEmailNotification(email);
    }

    return NextResponse.json({
      success: true,
      message: "Chay nhac lich thanh cong",
      data: { total_due: rows.length },
    });
  } catch {
    await connection.rollback();
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  } finally {
    connection.release();
  }
}
