import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcrypt";
import { LoginRequestBody, User } from "@/types/auth";
import { generateToken } from "@/lib/jwt";
import { consumeRateLimit, getClientIpFromHeaders } from "@/lib/rateLimit";
import { issueRefreshToken } from "@/lib/refreshToken";
import { writeAuditLog } from "@/lib/auditLog";

// MẪU ĐỌC FILE API (cơ bản):
// 1) Validate input.
// 2) Query DB.
// 3) Kiem tra nghiệp vụ (mật khẩu, status...).
// 4) Tra JSON ket qua.

// Dang nhap chung cho tat ca role: patient, doctor, admin
export async function POST(req: Request) {
  try {
    const ip = getClientIpFromHeaders(req.headers);
    const userAgent = req.headers.get("user-agent");
    const rate = await consumeRateLimit(`auth:login:${ip}`, 20, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, message: "Quá nhiều lần thử, vui long thử lại sau" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      );
    }

    const body = (await req.json()) as LoginRequestBody;
    const normalizedPhone = typeof body.phone === "string" ? body.phone.trim() : typeof body.username === "string" ? body.username.trim() : "";
    const normalizedPassword = typeof body.password === "string" ? body.password : "";

    // Validate body dau vao
    if (!normalizedPhone || !normalizedPassword) {
      await writeAuditLog({
        action: "auth.login",
        status: "failed",
        ip,
        user_agent: userAgent,
        detail: "Thieu phone/password",
      });
      return NextResponse.json({ message: "Sai Số điện thoại hoặc Mật khẩu" }, { status: 401 });
    }

    // STEP 2: Tim user theo phone
    const [rows] = await db.execute<User[]>(
      "SELECT * FROM users WHERE phone = ?",
      [normalizedPhone]
    );

    if (rows.length === 0) {
      await writeAuditLog({
        action: "auth.login",
        status: "failed",
        ip,
        user_agent: userAgent,
        detail: `Không tim thay user: ${normalizedPhone}`,
      });
      return NextResponse.json({ message: "Sai số điện thoại hoặc mật khẩu" }, { status: 401 });
    }

    const user = rows[0];

    // STEP 3: So sanh password text voi password hash trong DB
    const isMatch = await bcrypt.compare(normalizedPassword, user.password);
    if (!isMatch) {
      await writeAuditLog({
        user_id: user.id,
        action: "auth.login",
        status: "failed",
        ip,
        user_agent: userAgent,
        detail: "Sai mat khau",
      });
      return NextResponse.json({ message: "Sai số điện thoại hoặc mật khẩu" }, { status: 401 });
    }

    // Chi cho phep user active đăng nhập
    if (user.status !== "active") {
      await writeAuditLog({
        user_id: user.id,
        action: "auth.login",
        status: "failed",
        ip,
        user_agent: userAgent,
        detail: `Tai khoan status=${user.status}`,
      });
      return NextResponse.json({ message: "Tài khoản đã bị khóa hoặc ngừng hoạt động" }, { status: 403 });
    }

    // STEP 4: Dang nhap hop le -> cap access token + refresh token
    const token = generateToken({
      id: user.id,
      username: user.phone,
      role: user.role,
    });
    const refresh_token = await issueRefreshToken(
      { id: user.id, username: user.phone, role: user.role },
      ip,
      userAgent
    );

    await writeAuditLog({
      user_id: user.id,
      action: "auth.login",
      status: "success",
      ip,
      user_agent: userAgent,
      detail: `Dang nhap thanh cong role=${user.role}`,
    });

    return NextResponse.json({
      success: true,
      message: "Dăng nhập thành công",
      token,
      refresh_token,
      user: {
        id: user.id,
        username: user.phone,
        role: user.role,
        full_name: user.full_name,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);

    // Bat loi ket noi DB de trả message de hieu hon
    if ((error as { code?: string }).code === "ECONNREFUSED" || (error as { code?: string }).code === "ETIMEDOUT") {
      return NextResponse.json(
        { message: "Khong the ket noi co so du lieu, vui long thu lai sau" },
        { status: 503 }
      );
    }

    return NextResponse.json({ message: "Loi server" }, { status: 500 });
  }
}
