import { NextResponse } from "next/server";
import { db, hasTableColumn } from "@/lib/db";
import bcrypt from "bcrypt";
import { ResultSetHeader } from "mysql2";
import { generateCode } from "@/lib/generateCode";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

    if (!phone || !password || !fullName || !email) {
      return NextResponse.json({ message: "Thieu du lieu bat buoc" }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ message: "Email khong hop le" }, { status: 400 });
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
      return NextResponse.json({ message: "Phone hoac email da ton tai" }, { status: 409 });
    }

    return NextResponse.json({ message: "Loi server" }, { status: 500 });
  } finally {
    connection.release();
  }
}
