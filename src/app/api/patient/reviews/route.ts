import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";

type CreateReviewBody = {
  appointment_id?: unknown;
  rating?: unknown;
  comment?: unknown;
};

function countChars(text: string): number {
  return text.trim().length;
}

interface OwnedAppointmentRow extends RowDataPacket {
  appointment_id: number;
  doctor_id: number | null;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  medical_record_id: number | null;
}

interface ReviewRow extends RowDataPacket {
  id: number;
}

export async function POST(req: NextRequest) {
  const connection = await db.getConnection();
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi patient moi duoc danh gia" },
        { status: 403 }
      );
    }

    let body: CreateReviewBody;
    try {
      body = (await req.json()) as CreateReviewBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const appointmentId = Number(body.appointment_id);
    const rating = Number(body.rating);
    const comment = typeof body.comment === "string" ? body.comment.trim() : null;
    const commentCharCount = comment ? countChars(comment) : 0;

    if (!Number.isFinite(appointmentId) || appointmentId <= 0) {
      return NextResponse.json(
        { success: false, message: "appointment_id khong hop le" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { success: false, message: "rating phai tu 1 den 5" },
        { status: 400 }
      );
    }
    if (commentCharCount > 100) {
      return NextResponse.json(
        { success: false, message: "Nh?n xét t?i đa 100 k? t?" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [appointmentRows] = await connection.execute<OwnedAppointmentRow[]>(
      `SELECT a.id AS appointment_id, a.status,
              COALESCE(a.doctor_id, s.doctor_id) AS doctor_id,
              mr.id AS medical_record_id
       FROM appointments a
       LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
       LEFT JOIN medical_records mr ON mr.appointment_id = a.id
       WHERE a.id = ? AND a.user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [appointmentId, authUser.id]
    );

    if (appointmentRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Lich hen khong ton tai" },
        { status: 404 }
      );
    }

    const appointment = appointmentRows[0];
    if (appointment.status !== "completed") {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chi duoc danh gia sau khi kham hoan tat" },
        { status: 400 }
      );
    }

    if (!appointment.doctor_id) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Khong tim thay bac si de danh gia" },
        { status: 400 }
      );
    }

    const [existingRows] = await connection.execute<ReviewRow[]>(
      `SELECT id
       FROM doctor_reviews
       WHERE user_id = ? AND appointment_id = ?
       LIMIT 1`,
      [authUser.id, appointmentId]
    );

    if (existingRows.length > 0) {
      await connection.execute<ResultSetHeader>(
        `UPDATE doctor_reviews
         SET rating = ?, comment = ?, medical_record_id = ?, updated_at = NOW()
         WHERE id = ?`,
        [rating, comment || null, appointment.medical_record_id || null, existingRows[0].id]
      );
    } else {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO doctor_reviews
         (user_id, doctor_id, appointment_id, medical_record_id, rating, comment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          authUser.id,
          appointment.doctor_id,
          appointmentId,
          appointment.medical_record_id || null,
          rating,
          comment || null,
        ]
      );
    }

    await connection.commit();
    return NextResponse.json({
      success: true,
      message: "Luu danh gia thanh cong",
    });
  } catch {
    await connection.rollback();
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
