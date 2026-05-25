import { PoolConnection } from "mysql2/promise";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";

interface WaitlistCandidateRow extends RowDataPacket {
  id: number;
  user_id: number;
}

interface SlotInfoRow extends RowDataPacket {
  work_date: string;
  start_time: string;
  end_time: string;
  service_name: string | null;
}

export async function notifyWaitingPatientForSlot(connection: PoolConnection, slotId: number) {
  const [candidateRows] = await connection.execute<WaitlistCandidateRow[]>(
    `SELECT id, user_id
     FROM appointment_waitlist
     WHERE slot_id = ? AND status = 'waiting'
     ORDER BY created_at ASC, id ASC
     LIMIT 1
     FOR UPDATE`,
    [slotId]
  );

  if (candidateRows.length === 0) return;

  const candidate = candidateRows[0];

  const [slotRows] = await connection.execute<SlotInfoRow[]>(
    `SELECT s.work_date, s.start_time, s.end_time, sv.name AS service_name
     FROM doctor_schedule_slots s
     LEFT JOIN services sv ON sv.id = s.service_id
     WHERE s.id = ?
     LIMIT 1`,
    [slotId]
  );

  const slot = slotRows[0];
  const slotText = slot
    ? `${slot.work_date} ${slot.start_time.slice(0, 5)}-${slot.end_time.slice(0, 5)}${
        slot.service_name ? ` (${slot.service_name})` : ""
      }`
    : `#${slotId}`;

  await connection.execute<ResultSetHeader>(
    `UPDATE appointment_waitlist
     SET status = 'notified', notified_at = NOW()
     WHERE id = ?`,
    [candidate.id]
  );

  const actionUrlReady = await getNotificationActionUrlReady();
  const message = `Slot trong danh sach cho da co cho: ${slotText}`;
  if (actionUrlReady) {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
       VALUES (?, ?, ?, false, NOW())`,
      [candidate.user_id, message, "/patient/appointments"]
    );
  } else {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO notifications (user_id, message, is_read, created_at)
       VALUES (?, ?, false, NOW())`,
      [candidate.user_id, message]
    );
  }
}
