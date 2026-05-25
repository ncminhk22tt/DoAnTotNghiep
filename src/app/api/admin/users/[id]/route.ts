// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader } from "mysql2";

// Admin cap nhat trảng thai active/inactive cho 1 patient
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = Number(id);
    const { status }: { status: "active" | "inactive" } = await req.json();

    // Validate body va id
    if (!status) {
      return NextResponse.json({ success: false, message: "Thieu du lieu" }, { status: 400 });
    }

    if (!id || Number.isNaN(userId) || userId <= 0) {
      return NextResponse.json({ message: "ID khong hop le" }, { status: 400 });
    }

    await db.execute<ResultSetHeader>(
      "UPDATE users SET status = ? WHERE id = ?",
      [status, userId]
    );

    return NextResponse.json({
      success: true,
      message: "Cap nhat trang thai thanh cong",
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}
