import { NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";

interface DoctorUserRow extends RowDataPacket {
  id: number;
  username: string;
  full_name: string;
  status: "active" | "inactive" | "banned";
  doctor_code: string | null;
}

// GET /api/admin/doctors/users
// Lay danh sach user role doctor de admin setup ho so doctor.
export async function GET() {
  try {
    const [rows] = await db.execute<DoctorUserRow[]>(
      `SELECT u.id, u.phone AS username, u.full_name, u.status, d.doctor_code
       FROM users u
       LEFT JOIN doctors d ON d.user_id = u.id
       WHERE u.role = 'doctor'
       ORDER BY u.id DESC`
    );

    return NextResponse.json({
      success: true,
      message: "Lay danh sach user doctor thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}
