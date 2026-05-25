import { RowDataPacket, ResultSetHeader } from "mysql2";
import { PoolConnection } from "mysql2/promise";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";

interface UserRow extends RowDataPacket {
  id: number;
  full_name: string;
  role: "patient" | "doctor" | "admin";
}

interface RiskCountRow extends RowDataPacket {
  cancelled_count: number;
  no_show_count: number;
}

interface AdminRow extends RowDataPacket {
  id: number;
}

const RISK_WINDOW_DAYS = Number(process.env.PATIENT_RISK_WINDOW_DAYS) || 30;
const CANCEL_THRESHOLD = Number(process.env.PATIENT_RISK_CANCEL_THRESHOLD) || 3;
const NO_SHOW_THRESHOLD = Number(process.env.PATIENT_RISK_NO_SHOW_THRESHOLD) || 2;
const ALERT_COOLDOWN_HOURS = Number(process.env.PATIENT_RISK_ALERT_COOLDOWN_HOURS) || 24;

function formatDateYmd(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function evaluatePatientRiskAndNotifyAdmins(
  connection: PoolConnection,
  patientUserId: number
) {
  const [userRows] = await connection.execute<UserRow[]>(
    "SELECT id, full_name, role FROM users WHERE id = ? LIMIT 1",
    [patientUserId]
  );

  if (userRows.length === 0) return;
  const user = userRows[0];
  if (user.role !== "patient") return;

  const boundary = new Date();
  boundary.setDate(boundary.getDate() - RISK_WINDOW_DAYS);
  const boundaryDate = formatDateYmd(boundary);

  const [countRows] = await connection.execute<RiskCountRow[]>(
    `SELECT
        SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
        SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) AS no_show_count
     FROM appointments a
     LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
     WHERE a.user_id = ?
       AND COALESCE(s.work_date, DATE(a.created_at)) >= ?`,
    [patientUserId, boundaryDate]
  );

  const cancelledCount = Number(countRows[0]?.cancelled_count || 0);
  const noShowCount = Number(countRows[0]?.no_show_count || 0);

  if (cancelledCount < CANCEL_THRESHOLD && noShowCount < NO_SHOW_THRESHOLD) {
    return;
  }

  const marker = `[RISK][user:${patientUserId}]`;
  const [existsRows] = await connection.execute<RowDataPacket[]>(
    `SELECT id
     FROM notifications
     WHERE message LIKE ?
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
     LIMIT 1`,
    [`%${marker}%`, ALERT_COOLDOWN_HOURS]
  );

  if (existsRows.length > 0) return;

  const [adminRows] = await connection.execute<AdminRow[]>(
    "SELECT id FROM users WHERE role = 'admin' AND status = 'active'"
  );

  if (adminRows.length === 0) return;

  const message = `${marker} Benh nhan ${user.full_name} (id=${patientUserId}) co ${cancelledCount} lan huy lich va ${noShowCount} lan vang mat trong ${RISK_WINDOW_DAYS} ngay. De xuat xem xet khoa tai khoan.`;
  const actionUrlReady = await getNotificationActionUrlReady();

  for (const admin of adminRows) {
    if (actionUrlReady) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
         VALUES (?, ?, ?, false, NOW())`,
        [admin.id, message, "/admin/users"]
      );
    } else {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO notifications (user_id, message, is_read, created_at)
         VALUES (?, ?, false, NOW())`,
        [admin.id, message]
      );
    }
  }
}

