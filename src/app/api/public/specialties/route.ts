// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface SpecialtyRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  logo_url: string | null;
}

// GET /api/public/specialties
export async function GET() {
  try {
    const [rows] = await db.execute<SpecialtyRow[]>(
      `SELECT id, name, description, logo_url
       FROM specialties
       ORDER BY name ASC`
    );

    return NextResponse.json({
      success: true,
      message: "Lay danh sach chuyen khoa thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}


