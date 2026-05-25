// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import crypto from "crypto";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { consumeRateLimit, getClientIpFromHeaders } from "@/lib/rateLimit";
import { sendEmailNotification } from "@/lib/notificationService";

type ForgotPasswordBody = {
  phone?: unknown;
  email?: unknown;
};

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  email: string | null;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// POST /api/auth/forgot-password
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIpFromHeaders(req.headers);
    const rate = await consumeRateLimit(`auth:forgot:${ip}`, 8, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, message: "Qua nhieu lan thu, vui long thu lai sau" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      );
    }

    let body: ForgotPasswordBody;
    try {
      body = (await req.json()) as ForgotPasswordBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";

    if (!phone && !email) {
      return NextResponse.json(
        { success: false, message: "Can phone hoac email" },
        { status: 400 }
      );
    }

    let sql = "SELECT id, phone AS username, email FROM users WHERE 1 = 1";
    const params: Array<string> = [];
    if (phone) {
      sql += " AND phone = ?";
      params.push(phone);
    }
    if (email) {
      sql += " AND email = ?";
      params.push(email);
    }
    sql += " LIMIT 1";

    const [rows] = await db.execute<UserRow[]>(sql, params);

    // Bao mat: van trả success du tim thay hay không
    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Neu tai khoan ton tai, he thong da tao yeu cau reset",
      });
    }

    const user = rows[0];
    const token = crypto.randomBytes(24).toString("hex");
    const tokenHash = sha256(token);

    await db.execute<ResultSetHeader>(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
      [user.id, tokenHash]
    );

    const isProduction = process.env.NODE_ENV === "production";
    const allowDevToken = process.env.DEBUG_RETURN_RESET_TOKEN === "true";

    const payload: {
      success: boolean;
      message: string;
      data?: { reset_token: string; expires_in_minutes: number };
    } = {
      success: true,
      message: "Tao yeu cau reset thanh cong",
    };

    if (!isProduction || allowDevToken) {
      payload.data = { reset_token: token, expires_in_minutes: 30 };
    }

    if (user.email) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const resetLink = `${appUrl}/register?reset_token=${encodeURIComponent(token)}`;
      await sendEmailNotification({
        to: user.email,
        subject: "Dat lai mat khau Medical Booking",
        content: `Xin chao ${user.username}, ma reset cua ban la ${token}. Link nhanh: ${resetLink}. Hieu luc 30 phut.`,
      });
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

