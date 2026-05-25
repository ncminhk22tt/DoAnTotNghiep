import { NextRequest, NextResponse } from "next/server";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getAppointmentWorkflowSchemaReady } from "@/lib/appointmentWorkflowSchema";
import { writeAuditLog } from "@/lib/auditLog";

interface AppointmentRow extends RowDataPacket {
  id: number;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
  checked_in_at: string | null;
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
  let appointmentIdForAudit: number | null = null;

  try {
    await getAppointmentWorkflowSchemaReady();
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "admin") {
      return NextResponse.json(
        { success: false, message: "Chi admin moi duoc check-in" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const appointmentId = parseAppointmentId(id);
    appointmentIdForAudit = appointmentId;
    if (!appointmentId) {
      return NextResponse.json(
        { success: false, message: "appointment_id khong hop le" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();
    const [rows] = await connection.execute<AppointmentRow[]>(
      `SELECT id, status, checked_in_at
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
    if (["completed", "cancelled"].includes(appointment.status)) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Khong the check-in cho lich da hoan tat/huy" },
        { status: 400 }
      );
    }

    if (appointment.checked_in_at) {
      await connection.rollback();
      return NextResponse.json({
        success: true,
        message: "Lich hen da duoc check-in truoc do",
      });
    }

    await connection.execute<ResultSetHeader>(
      `UPDATE appointments
       SET checked_in_at = NOW(),
           checked_in_by = ?,
           status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
       WHERE id = ?`,
      [authUser.id, appointmentId]
    );

    await connection.commit();
    await writeAuditLog({
      user_id: authUser.id,
      action: "admin_appointment_check_in",
      entity_type: "appointment",
      entity_id: appointmentId,
      status: "success",
      detail: "Check-in tai quay thanh cong",
    });

    return NextResponse.json({
      success: true,
      message: "Check-in thanh cong",
    });
  } catch {
    await connection.rollback();
    await writeAuditLog({
      action: "admin_appointment_check_in",
      entity_type: "appointment",
      entity_id: appointmentIdForAudit,
      status: "failed",
      detail: "Check-in tai quay that bai",
    });
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}

