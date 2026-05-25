// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader } from "mysql2";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";

type CreateNotificationBody = {
  user_id?: unknown;
  message?: unknown;
  action_url?: unknown;
};

// POST /api/admin/notifications
export async function POST(req: NextRequest) {
  try {
    let body: CreateNotificationBody;
    try {
      body = (await req.json()) as CreateNotificationBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const userId = typeof body.user_id === "number" ? body.user_id : Number.NaN;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const actionUrl = typeof body.action_url === "string" ? body.action_url.trim() : null;

    if (!userId || Number.isNaN(userId) || userId <= 0 || !message) {
      return NextResponse.json(
        { success: false, message: "Du lieu khong hop le" },
        { status: 400 }
      );
    }

    const actionUrlReady = await getNotificationActionUrlReady();
    const [result] = await db.execute<ResultSetHeader>(
      actionUrlReady
        ? `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
           VALUES (?, ?, ?, false, NOW())`
        : `INSERT INTO notifications (user_id, message, is_read, created_at)
           VALUES (?, ?, false, NOW())`,
      actionUrlReady ? [userId, message, actionUrl] : [userId, message]
    );

    return NextResponse.json({
      success: true,
      message: "Gui thong bao thanh cong",
      data: { id: result.insertId },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}


