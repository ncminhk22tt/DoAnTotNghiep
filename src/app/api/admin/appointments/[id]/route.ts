// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { canTransitionAppointmentStatus } from "@/lib/appointmentStatus";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";
import { getAppointmentDecisionSchemaReady } from "@/lib/appointmentDecisionSchema";
import { getAppointmentWorkflowSchemaReady } from "@/lib/appointmentWorkflowSchema";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { writeAuditLog } from "@/lib/auditLog";
import { notifyWaitingPatientForSlot } from "@/lib/waitlistService";
import { evaluatePatientRiskAndNotifyAdmins } from "@/lib/userRiskMonitor";

type UpdateAppointmentBody = {
  status?: unknown;
  decision_note?: unknown;
};

interface AppointmentRow extends RowDataPacket {
  id: number;
  user_id: number;
  slot_id: number | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
}

interface SlotRow extends RowDataPacket {
  id: number;
  booked_count: number;
  max_patients: number;
  status: "available" | "full" | "closed";
}

function parseAppointmentId(id: string): number | null {
  const appointmentId = Number(id);
  if (!id || Number.isNaN(appointmentId) || appointmentId <= 0) return null;
  return appointmentId;
}

// PATCH /api/admin/appointments/{id}
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();

  try {
    await getAppointmentWorkflowSchemaReady();
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "admin") {
      return NextResponse.json(
        { success: false, message: "Chi admin moi duoc cap nhat lich hen" },
        { status: 403 }
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

    let body: UpdateAppointmentBody;
    try {
      body = (await req.json()) as UpdateAppointmentBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const status =
      typeof body.status === "string" && ["pending", "confirmed", "completed", "cancelled", "no_show"].includes(body.status)
        ? (body.status as AppointmentRow["status"])
        : null;
    const decisionNote = typeof body.decision_note === "string" ? body.decision_note.trim() : null;

    if (!status) {
      return NextResponse.json(
        { success: false, message: "status khong hop le" },
        { status: 400 }
      );
    }
    if (status === "cancelled" && !decisionNote) {
      return NextResponse.json(
        { success: false, message: "Vui long nhap ly do tu choi/huy lich" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();
    const decisionReady = await getAppointmentDecisionSchemaReady();

    const [appointmentRows] = await connection.execute<AppointmentRow[]>(
      `SELECT id, user_id, slot_id, status
       FROM appointments
       WHERE id = ?
       FOR UPDATE`,
      [appointmentId]
    );

    if (appointmentRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen khong ton tai" },
        { status: 404 }
      );
    }

    const appointment = appointmentRows[0];

    if (!canTransitionAppointmentStatus(appointment.status, status)) {
      await connection.rollback();
      return NextResponse.json(
        {
          success: false,
          message: `Khong the chuyen trang thai tu '${appointment.status}' sang '${status}'`,
        },
        { status: 400 }
      );
    }

    if (appointment.slot_id && status === "cancelled" && ["pending", "confirmed"].includes(appointment.status)) {
      const [slotRows] = await connection.execute<SlotRow[]>(
        `SELECT id, booked_count, max_patients, status
         FROM doctor_schedule_slots
         WHERE id = ?
         FOR UPDATE`,
        [appointment.slot_id]
      );

      if (slotRows.length > 0) {
        const slot = slotRows[0];
        await connection.execute<ResultSetHeader>(
          `UPDATE doctor_schedule_slots
           SET booked_count = GREATEST(booked_count - 1, 0)
           WHERE id = ?`,
          [slot.id]
        );

        const newBookedCount = Math.max(slot.booked_count - 1, 0);
        if (slot.status === "full" && newBookedCount < 1) {
          await connection.execute(
            `UPDATE doctor_schedule_slots
             SET status = 'available'
             WHERE id = ?`,
            [slot.id]
          );
        }
      }
    }

    if (decisionReady) {
      await connection.execute<ResultSetHeader>(
        `UPDATE appointments
         SET status = ?, admin_note = ?, checked_in_at = CASE WHEN ? = 'cancelled' THEN NULL ELSE checked_in_at END, checked_in_by = CASE WHEN ? = 'cancelled' THEN NULL ELSE checked_in_by END
         WHERE id = ?`,
        [status, decisionNote ?? null, status, status, appointmentId]
      );
    } else {
      await connection.execute<ResultSetHeader>(
        `UPDATE appointments
         SET status = ?, checked_in_at = CASE WHEN ? = 'cancelled' THEN NULL ELSE checked_in_at END, checked_in_by = CASE WHEN ? = 'cancelled' THEN NULL ELSE checked_in_by END
         WHERE id = ?`,
        [status, status, status, appointmentId]
      );
    }

    if (appointment.slot_id && status === "cancelled" && ["pending", "confirmed"].includes(appointment.status)) {
      const [slotRowsForWaitlist] = await connection.execute<SlotRow[]>(
        `SELECT id, booked_count, max_patients, status
         FROM doctor_schedule_slots
         WHERE id = ?`,
        [appointment.slot_id]
      );
      const slotForWaitlist = slotRowsForWaitlist[0];
      if (slotForWaitlist && slotForWaitlist.booked_count < 1) {
        await notifyWaitingPatientForSlot(connection, appointment.slot_id);
      }
    }

    const statusMessage =
      status === "confirmed"
        ? `Lich hen #${appointmentId} da duoc xac nhan`
        : status === "cancelled"
        ? `Lich hen #${appointmentId} da bi tu choi`
        : `Lich hen #${appointmentId} da duoc cap nhat sang '${status}'`;
    const notifyMessage =
      status === "cancelled" && decisionNote
        ? `${statusMessage}. Ly do: ${decisionNote}`
        : statusMessage;

    await connection.commit();

    void (async () => {
      try {
        const actionUrlReady = await getNotificationActionUrlReady();
        await db.execute<ResultSetHeader>(
          actionUrlReady
            ? `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
               VALUES (?, ?, ?, false, NOW())`
            : `INSERT INTO notifications (user_id, message, is_read, created_at)
               VALUES (?, ?, false, NOW())`,
          actionUrlReady
            ? [appointment.user_id, notifyMessage, "/patient/appointments"]
            : [appointment.user_id, notifyMessage]
        );
      } catch (notificationError) {
        console.error("Failed to create admin appointment notification:", notificationError);
      }
    })();

    if (status === "cancelled" || status === "no_show") {
      void (async () => {
        const riskConnection = await db.getConnection();
        try {
          await evaluatePatientRiskAndNotifyAdmins(riskConnection, appointment.user_id);
        } catch (riskError) {
          console.error("Failed to evaluate patient risk after admin update:", riskError);
        } finally {
          riskConnection.release();
        }
      })();
    }

    void writeAuditLog({
        user_id: authUser.id,
        action: "admin_appointment_status_update",
        entity_type: "appointment",
        entity_id: appointmentId,
        status: "success",
        detail: `status: ${appointment.status} -> ${status}${decisionNote ? `; note: ${decisionNote}` : ""}`,
      }).catch((auditError) => {
        console.error("Failed to write admin appointment audit log:", auditError);
      });

    return NextResponse.json({
      success: true,
      message: "Cap nhat lich hen thanh cong",
      data: {
        appointment_id: appointmentId,
        old_status: appointment.status,
        new_status: status,
        admin_note: decisionNote ?? null,
      },
    });
  } catch (error) {
    await connection.rollback();
    await writeAuditLog({
      action: "admin_appointment_status_update",
      entity_type: "appointment",
      status: "failed",
      detail: "Cap nhat trang thai lich hen that bai",
    });
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { success: false, message: "Slot nay da co lich kham" },
        { status: 400 }
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
