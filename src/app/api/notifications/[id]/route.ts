// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";

interface NotificationRow extends RowDataPacket {
  id: number;
  user_id: number;
}

function parseNotificationId(id: string): number | null {
  const notificationId = Number(id);
  if (!id || Number.isNaN(notificationId) || notificationId <= 0) return null;
  return notificationId;
}

// PATCH /api/notifications/{id}
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser) {
      return NextResponse.json(
        { success: false, message: "Ban chua dang nhap" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const notificationId = parseNotificationId(id);
    if (!notificationId) {
      return NextResponse.json(
        { success: false, message: "notification_id khong hop le" },
        { status: 400 }
      );
    }

    const [rows] = await db.execute<NotificationRow[]>(
      "SELECT id, user_id FROM notifications WHERE id = ? LIMIT 1",
      [notificationId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Thong bao khong ton tai" },
        { status: 404 }
      );
    }

    if (rows[0].user_id !== authUser.id) {
      return NextResponse.json(
        { success: false, message: "Khong du quyen cap nhat thong bao" },
        { status: 403 }
      );
    }

    await db.execute<ResultSetHeader>(
      `UPDATE notifications
       SET is_read = true
       WHERE id = ?`,
      [notificationId]
    );

    return NextResponse.json({
      success: true,
      message: "Danh dau thong bao da doc thanh cong",
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

