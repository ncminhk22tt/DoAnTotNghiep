import { NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";

interface ReviewRow extends RowDataPacket {
  id: number;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer_name: string;
}

function parseDoctorId(id: string): number | null {
  const doctorId = Number(id);
  if (!id || Number.isNaN(doctorId) || doctorId <= 0) return null;
  return doctorId;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const doctorId = parseDoctorId(id);
    if (!doctorId) {
      return NextResponse.json(
        { success: false, message: "doctor_id khong hop le" },
        { status: 400 }
      );
    }

    const [rows] = await db.execute<ReviewRow[]>(
      `SELECT dr.id, dr.rating, dr.comment, dr.created_at,
              u.full_name AS reviewer_name
       FROM doctor_reviews dr
       JOIN users u ON u.id = dr.user_id
       WHERE dr.doctor_id = ?
       ORDER BY dr.created_at DESC, dr.id DESC
       LIMIT 50`,
      [doctorId]
    );

    return NextResponse.json({
      success: true,
      message: "Lay danh sach danh gia thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}
