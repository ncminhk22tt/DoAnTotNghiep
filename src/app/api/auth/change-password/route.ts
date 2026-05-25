// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { db } from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { consumeRateLimit, getClientIpFromHeaders } from "@/lib/rateLimit";

type ChangePasswordBody = {
  old_password?: unknown;
  new_password?: unknown;
};

interface UserPasswordRow extends RowDataPacket {
  id: number;
  password: string;
}

// POST /api/auth/change-password
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIpFromHeaders(req.headers);
    const rate = await consumeRateLimit(`auth:change-password:${ip}`, 20, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, message: "Qua nhieu lan thu, vui long thu lai sau" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      );
    }

    const authUser = getAuthUserFromRequest(req);
    if (!authUser) {
      return NextResponse.json(
        { success: false, message: "Ban chua dang nhap" },
        { status: 401 }
      );
    }

    let body: ChangePasswordBody;
    try {
      body = (await req.json()) as ChangePasswordBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const oldPassword = typeof body.old_password === "string" ? body.old_password : "";
    const newPassword = typeof body.new_password === "string" ? body.new_password : "";

    if (!oldPassword || !newPassword) {
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

    const [rows] = await db.execute<UserPasswordRow[]>(
      "SELECT id, password FROM users WHERE id = ? LIMIT 1",
      [authUser.id]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Tai khoan khong ton tai" },
        { status: 404 }
      );
    }

    const user = rows[0];
    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) {
      return NextResponse.json(
        { success: false, message: "Mat khau cu khong dung" },
        { status: 400 }
      );
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.execute<ResultSetHeader>(
      "UPDATE users SET password = ? WHERE id = ?",
      [newHash, authUser.id]
    );

    return NextResponse.json({
      success: true,
      message: "Doi mat khau thanh cong",
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

