// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { User } from "@/types/auth";

// Admin lấy danh sach user role patient
export async function GET(_req: NextRequest) {
  try {
    const [rows] = await db.execute<User[]>(
      `SELECT id, phone AS username, full_name, role, status, created_at
       FROM users
       WHERE role = ?
       ORDER BY created_at DESC`,
      ["patient"]
    );

    return NextResponse.json({
      success: true,
      message: "Lay danh sach user thanh cong",
      data: rows,
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

