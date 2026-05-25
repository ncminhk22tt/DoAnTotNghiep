// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { consumeRateLimit, getClientIpFromHeaders } from "@/lib/rateLimit";

type ResetPasswordBody = {
  token?: unknown;
  new_password?: unknown;
};

interface ResetTokenRow extends RowDataPacket {
  id: number;
  user_id: number;
  token: string;
  expires_at: string;
  used_at: string | null;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// POST /api/auth/reset-password
export async function POST(req: NextRequest) {
  const connection = await db.getConnection();

  try {
    const ip = getClientIpFromHeaders(req.headers);
    const rate = await consumeRateLimit(`auth:reset:${ip}`, 10, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, message: "Qua nhieu lan thu, vui long thu lai sau" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      );
    }

    let body: ResetPasswordBody;
    try {
      body = (await req.json()) as ResetPasswordBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const token = typeof body.token === "string" ? body.token.trim() : "";
    const newPassword = typeof body.new_password === "string" ? body.new_password : "";

    if (!token || !newPassword) {
      return NextResponse.json(
        { success: false, message: "Thieu du lieu" },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { success: false, message: "Mat khau moi phai tu 6 ky tu" },
        { status: 400 }
      );
    }

    const tokenHash = sha256(token);

    await connection.beginTransaction();

    const [rows] = await connection.execute<ResetTokenRow[]>(
      `SELECT id, user_id, token, expires_at, used_at
       FROM password_reset_tokens
       WHERE token = ?
       FOR UPDATE`,
      [tokenHash]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Token reset khong hop le" },
        { status: 400 }
      );
    }

    const resetRow = rows[0];

    if (resetRow.used_at) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Token reset da duoc su dung" },
        { status: 400 }
      );
    }

    const now = new Date();
    const expiresAt = new Date(resetRow.expires_at);
    if (expiresAt < now) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Token reset da het han" },
        { status: 400 }
      );
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await connection.execute<ResultSetHeader>(
      "UPDATE users SET password = ? WHERE id = ?",
      [newHash, resetRow.user_id]
    );

    await connection.execute<ResultSetHeader>(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?",
      [resetRow.id]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Dat lai mat khau thanh cong",
    });
  } catch {
    await connection.rollback();
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}

