import { NextResponse } from "next/server";
import { db, hasTableColumn } from "@/lib/db";
import bcrypt from "bcrypt";
import { ResultSetHeader } from "mysql2";
import { generateCode } from "@/lib/generateCode";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password: string): boolean {
  return /^[A-Za-z0-9]{8,15}$/.test(password);
}

function isValidDoctorName(value: string): boolean {
  const normalizedValue = value.trim();
  return normalizedValue.length >= 1
    && normalizedValue.length <= 50
    && /^[\p{L}]+(?:\s+[\p{L}]+)*$/u.test(normalizedValue);
}

// Admin tao tai khoan doctor va tao ho so doctor co ma bac si tu dong.
export async function POST(req: Request) {
  const connection = await db.getConnection();

  try {
    const body = (await req.json()) as {
      phone?: unknown;
      password?: unknown;
      full_name?: unknown;
      email?: unknown;
    };

    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const isDoctorNameValid = isValidDoctorName(fullName);

    if (!phone || !password || !fullName || !email) {
      return NextResponse.json({ message: "Thieu du lieu bat buoc" }, { status: 400 });
    }

    if (!isDoctorNameValid) {
      return NextResponse.json({ message: "Ho ten chi duoc 1 den 50 ky tu, gom chu cai va khoang trang giua cac tu" }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ message: "Email khong hop le" }, { status: 400 });
    }

    if (!isValidPassword(password)) {
      return NextResponse.json(
        { message: "Mat khau phai tu 8 den 15 ky tu va chi gom chu, so" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const includeUsername = await hasTableColumn("users", "username");

    await connection.beginTransaction();

    const fields = ["password"];
    const placeholders = ["?"];
    const params: Array<string> = [hashedPassword];

    if (includeUsername) {
      fields.push("username");
      placeholders.push("?");
      params.push(phone);
    }

    fields.push("full_name", "email", "phone", "role");
    placeholders.push("?", "?", "?", "'doctor'");
    params.push(fullName, email, phone);

    const [userResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO users (${fields.join(", ")}) VALUES (${placeholders.join(", ")})`,
      params
    );

    const doctorCode = await generateCode(connection, "doctor");

    await connection.execute<ResultSetHeader>(
      "INSERT INTO doctors (user_id, specialty_id, doctor_code, status) VALUES (?, NULL, ?, 'active')",
      [userResult.insertId, doctorCode]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Tao bac si thanh cong",
      data: {
        user_id: userResult.insertId,
        doctor_code: doctorCode,
      },
    });
  } catch (error) {
    await connection.rollback();

    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json({ message: "Số điện thoại hoặc email đã tồn tại" }, { status: 409 });
    }

    return NextResponse.json({ message: "Loi server" }, { status: 500 });
  } finally {
    connection.release();
  }
}


