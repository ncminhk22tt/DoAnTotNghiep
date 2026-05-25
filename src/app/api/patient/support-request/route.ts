import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getNotificationActionUrlReady } from "@/lib/notificationSchema";

interface SupportRequestBody {
  note?: unknown;
  last_user_question?: unknown;
}

interface AdminRow extends RowDataPacket {
  id: number;
}

function normalizeText(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value) return null;
  return value.slice(0, max);
}

export async function POST(req: NextRequest) {
  const connection = await db.getConnection();
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "patient") {
      return NextResponse.json(
        { success: false, message: "Chi benh nhan moi gui duoc yeu cau ho tro" },
        { status: 403 }
      );
    }

    let body: SupportRequestBody;
    try {
      body = (await req.json()) as SupportRequestBody;
    } catch {
      return NextResponse.json({ success: false, message: "JSON khong hop le" }, { status: 400 });
    }

    const note = normalizeText(body.note, 500);
    const lastQuestion = normalizeText(body.last_user_question, 400);
    const actionUrlReady = await getNotificationActionUrlReady();

    const [adminRows] = await connection.execute<AdminRow[]>(
      "SELECT id FROM users WHERE role = 'admin' AND status = 'active'"
    );
    if (!adminRows.length) {
      return NextResponse.json({ success: false, message: "He thong chua co admin hoat dong" }, { status: 400 });
    }

    const marker = `[CHAT_SUPPORT][user:${authUser.id}]`;
    const message = [
      `${marker} Benh nhan yeu cau ho tro truc tiep tu chatbox.`,
      lastQuestion ? `Cau hoi gan nhat: ${lastQuestion}` : null,
      note ? `Ghi chu benh nhan: ${note}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    await connection.beginTransaction();
    for (const admin of adminRows) {
      if (actionUrlReady) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO notifications (user_id, message, action_url, is_read, created_at)
           VALUES (?, ?, ?, false, NOW())`,
          [admin.id, message, "/admin/notifications"]
        );
      } else {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO notifications (user_id, message, is_read, created_at)
           VALUES (?, ?, false, NOW())`,
          [admin.id, message]
        );
      }
    }
    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Da gui yeu cau ho tro den admin",
    });
  } catch {
    await connection.rollback();
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  } finally {
    connection.release();
  }
}
