// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { generateToken, verifyRefreshToken } from "@/lib/jwt";
import { issueRefreshToken, revokeRefreshToken, validateRefreshToken } from "@/lib/refreshToken";
import { consumeRateLimit, getClientIpFromHeaders } from "@/lib/rateLimit";
import { writeAuditLog } from "@/lib/auditLog";

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  role: "patient" | "doctor" | "admin";
  status: "active" | "inactive" | "banned";
}

type RefreshBody = {
  refresh_token?: unknown;
};

// POST /api/auth/refresh
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIpFromHeaders(req.headers);
    const userAgent = req.headers.get("user-agent");
    const rate = await consumeRateLimit(`auth:refresh:${ip}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, message: "Qua nhieu lan thu, vui long thu lai sau" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      );
    }

    let body: RefreshBody;
    try {
      body = (await req.json()) as RefreshBody;
    } catch {
      return NextResponse.json({ success: false, message: "JSON khong hop le" }, { status: 400 });
    }

    const refreshToken =
      typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";
    if (!refreshToken) {
      return NextResponse.json(
        { success: false, message: "Thieu refresh_token" },
        { status: 400 }
      );
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      await writeAuditLog({
        action: "auth.refresh",
        status: "failed",
        ip,
        user_agent: userAgent,
        detail: "Refresh token JWT khong hop le",
      });
      return NextResponse.json(
        { success: false, message: "Refresh token khong hop le" },
        { status: 401 }
      );
    }

    const session = await validateRefreshToken(refreshToken);
    if (!session || session.user_id !== decoded.id) {
      await writeAuditLog({
        user_id: decoded.id,
        action: "auth.refresh",
        status: "failed",
        ip,
        user_agent: userAgent,
        detail: "Refresh token da revoke/het han/khong ton tai",
      });
      return NextResponse.json(
        { success: false, message: "Refresh token khong hop le hoac da het han" },
        { status: 401 }
      );
    }

    const [users] = await db.execute<UserRow[]>(
      "SELECT id, phone AS username, role, status FROM users WHERE id = ? LIMIT 1",
      [decoded.id]
    );

    if (users.length === 0 || users[0].status !== "active") {
      await revokeRefreshToken(refreshToken);
      return NextResponse.json(
        { success: false, message: "Tai khoan khong hop le" },
        { status: 403 }
      );
    }

    const user = users[0];

    // Rotation: token cu bi revoke, token moi duoc cap.
    await revokeRefreshToken(refreshToken);
    const newRefreshToken = await issueRefreshToken(
      { id: user.id, username: user.username, role: user.role },
      ip,
      userAgent
    );
    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    await writeAuditLog({
      user_id: user.id,
      action: "auth.refresh",
      status: "success",
      ip,
      user_agent: userAgent,
      detail: "Refresh token thanh cong",
    });

    return NextResponse.json({
      success: true,
      message: "Cap token moi thanh cong",
      token,
      refresh_token: newRefreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  }
}


