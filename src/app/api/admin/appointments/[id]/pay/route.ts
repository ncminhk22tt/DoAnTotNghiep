import { NextRequest, NextResponse } from "next/server";
import { db, hasTableColumn } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { writeAuditLog } from "@/lib/auditLog";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";

interface AppointmentRow extends RowDataPacket {
  id: number;
  user_id: number;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  payment_status: "unpaid" | "paid";
}

function parseAppointmentId(id: string): number | null {
  const appointmentId = Number(id);
  if (!id || Number.isNaN(appointmentId) || appointmentId <= 0) return null;
  return appointmentId;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "admin") {
      return NextResponse.json(
        { success: false, message: "Chi admin moi duoc cap nhat thanh toan" },
        { status: 403 }
      );
    }

    const paymentStatusReady = await hasTableColumn("appointments", "payment_status");
    const paidAtReady = await hasTableColumn("appointments", "paid_at");
    if (!paymentStatusReady || !paidAtReady) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Database chua cap nhat schema thanh toan. Vui long chay migration de them payment_status va paid_at.",
        },
        { status: 500 }
      );
    }

    const { id } = await params;
    const appointmentId = parseAppointmentId(id);
    if (!appointmentId) {
      return NextResponse.json(
        { success: false, message: "appointment_id khong hop le" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();
    const [rows] = await connection.execute<AppointmentRow[]>(
      `SELECT id, user_id, status, payment_status
       FROM appointments
       WHERE id = ?
       FOR UPDATE`,
      [appointmentId]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen khong ton tai" },
        { status: 404 }
      );
    }

    const appointment = rows[0];
    if (appointment.status !== "completed") {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chi co lich da hoan tat moi co the thanh toan" },
        { status: 400 }
      );
    }

    if (appointment.payment_status === "paid") {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen da duoc thanh toan" },
        { status: 400 }
      );
    }

    await connection.execute<ResultSetHeader>(
      `UPDATE appointments
       SET payment_status = 'paid', paid_at = NOW()
       WHERE id = ?`,
      [appointmentId]
    );

    const actionUrlReady = await getNotificationActionUrlReady();
    const paidMessage = `Lich hen #${appointmentId} da duoc thanh toan thanh cong.`;
    await connection.execute<ResultSetHeader>(
      actionUrlReady
        ? `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
           VALUES (?, ?, ?, false, NOW())`
        : `INSERT INTO notifications (user_id, message, is_read, created_at)
           VALUES (?, ?, false, NOW())`,
      actionUrlReady
        ? [appointment.user_id, paidMessage, "/patient/appointments"]
        : [appointment.user_id, paidMessage]
    );

    await connection.commit();
    await writeAuditLog({
      user_id: authUser.id,
      action: "admin_appointment_payment",
      entity_type: "appointment",
      entity_id: appointmentId,
      status: "success",
      detail: `payment_status: unpaid -> paid`,
    });

    return NextResponse.json({
      success: true,
      message: "Thanh toan thanh cong",
      data: { appointment_id: appointmentId },
    });
  } catch {
    await connection.rollback();
    await writeAuditLog({
      action: "admin_appointment_payment",
      entity_type: "appointment",
      status: "failed",
      detail: `appointment payment failed for appointment_id: ${JSON.stringify(await params)}`,
    });
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  } finally {
    connection.release();
  }
}
