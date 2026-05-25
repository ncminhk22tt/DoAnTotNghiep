// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";

interface NotificationRow extends RowDataPacket {
  id: number;
  user_id: number;
  message: string;
  action_url: string | null;
  is_read: 0 | 1;
  created_at: string;
}

// GET /api/notifications
export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser) {
      return NextResponse.json(
        { success: false, message: "Ban chua dang nhap" },
        { status: 401 }
      );
    }

    const unreadOnly = req.nextUrl.searchParams.get("unread") === "true";
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || 0);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 30) : 0;
    const actionUrlReady = await getNotificationActionUrlReady();

    let sql = `SELECT id, user_id, message, ${actionUrlReady ? "action_url" : "NULL AS action_url"}, is_read, created_at
               FROM notifications
               WHERE user_id = ?`;
    const params: Array<string | number> = [authUser.id];

    if (unreadOnly) {
      sql += " AND is_read = false";
    }

    sql += " ORDER BY created_at DESC, id DESC";
    if (limit > 0) {
      sql += ` LIMIT ${limit}`;
    }

    const [rows] = await db.execute<NotificationRow[]>(sql, params);

    return NextResponse.json({
      success: true,
      message: "Lay thong bao thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

// PATCH /api/notifications
// Danh dau tat ca thong bao cua user la da doc
export async function PATCH(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser) {
      return NextResponse.json(
        { success: false, message: "Ban chua dang nhap" },
        { status: 401 }
      );
    }

    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE notifications
       SET is_read = true
       WHERE user_id = ? AND is_read = false`,
      [authUser.id]
    );

    return NextResponse.json({
      success: true,
      message: "Danh dau da doc thanh cong",
      data: { affected_rows: result.affectedRows },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}


