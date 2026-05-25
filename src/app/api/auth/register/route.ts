import { NextResponse } from "next/server";
import { db, hasTableColumn } from "@/lib/db";
import bcrypt from "bcrypt";
import { ResultSetHeader } from "mysql2";
import { consumeRateLimit, getClientIpFromHeaders } from "@/lib/rateLimit";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone: string): boolean {
  return /^[0-9]{10,15}$/.test(phone);
}

function isValidPassword(password: string): boolean {
  return /^[A-Za-z0-9]{8,15}$/.test(password);
}

// Dang ky tai khoan patient
export async function POST(req: Request) {
  try {
    const ip = getClientIpFromHeaders(req.headers);
    const rate = await consumeRateLimit(`auth:register:${ip}`, 10, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, message: "Qua nhieu lan thu, vui long thu lai sau" },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } }
      );
    }

    const { password, full_name, email, phone } = await req.json();
    const normalizedPassword = typeof password === "string" ? password : "";
    const normalizedFullName = typeof full_name === "string" ? full_name.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
    const wordCount = normalizedFullName.split(/\s+/).filter(Boolean).length;

    if (!normalizedPhone || !normalizedPassword || !normalizedFullName || !normalizedEmail) {
      return NextResponse.json(
        { message: "Thieu full_name, email, phone hoac password" },
        { status: 400 }
      );
    }

    if (wordCount === 0 || wordCount > 50) {
      return NextResponse.json({ message: "Full name phai tu 1 den 50 tu" }, { status: 400 });
    }

    if (!isValidPhone(normalizedPhone)) {
      return NextResponse.json({ message: "Phone khong hop le" }, { status: 400 });
    }

    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json({ message: "Email khong hop le" }, { status: 400 });
    }

    if (!isValidPassword(normalizedPassword)) {
      return NextResponse.json(
        { message: "Password phai tu 8 den 15 ky tu chu va so" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(normalizedPassword, 10);
    const includeUsername = await hasTableColumn("users", "username");

    const fields = ["password"];
    const placeholders = ["?"];
    const params: Array<string> = [hashedPassword];

    if (includeUsername) {
      fields.push("username");
      placeholders.push("?");
      params.push(normalizedPhone);
    }

    fields.push("role", "full_name", "email", "phone");
    placeholders.push("'patient'", "?", "?", "?");
    params.push(normalizedFullName, normalizedEmail, normalizedPhone);

    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO users (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
      params
    );

    return NextResponse.json({
      success: true,
      message: "Dang ky thanh cong",
      data: {
        user_id: result.insertId,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json({ message: "Số điện thoại hoặc email đã tồn tại" }, { status: 409 });
    }

    return NextResponse.json({ message: "Loi server" }, { status: 500 });
  }
}
