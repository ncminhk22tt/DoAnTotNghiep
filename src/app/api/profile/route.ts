import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { db, hasTableColumn } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";

interface ProfileRow extends RowDataPacket {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  gender: string | null;
  birth_year: number | null;
  role: "patient" | "doctor" | "admin";
  status: "active" | "inactive" | "banned";
  created_at: string;
}

interface DoctorDescriptionRow extends RowDataPacket {
  description: string | null;
}

type UpdateProfileBody = {
  full_name?: unknown;
  phone?: unknown;
  email?: unknown;
  avatar?: unknown;
  gender?: unknown;
  birth_year?: unknown;
  description?: unknown;
};

interface ProfileUpdateSourceRow extends RowDataPacket {
  id: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  avatar: string | null;
  gender: string | null;
  birth_year: number | null;
}

function isValidPhone(phone: string): boolean {
  return /^[0-9]{10,15}$/.test(phone);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// GET /api/profile
export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser) {
      return NextResponse.json({ success: false, message: "Token khong hop le" }, { status: 401 });
    }

    const hasGender = await hasTableColumn("users", "gender");
    const hasBirthYear = await hasTableColumn("users", "birth_year");
    const genderSelect = hasGender ? "gender" : "NULL AS gender";
    const birthYearSelect = hasBirthYear ? "birth_year" : "NULL AS birth_year";

    const [rows] = await db.execute<ProfileRow[]>(
      `SELECT id, phone AS username, full_name, email, phone, avatar, ${genderSelect}, ${birthYearSelect}, role, status, created_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [authUser.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "User khong ton tai" }, { status: 404 });
    }

    const profile = rows[0] as ProfileRow & { description?: string | null };
    if (profile.role === "doctor") {
      const [doctorRows] = await db.execute<DoctorDescriptionRow[]>(
        `SELECT description
         FROM doctors
         WHERE user_id = ?
         LIMIT 1`,
        [authUser.id]
      );
      profile.description = doctorRows[0]?.description ?? null;
    }

    return NextResponse.json({
      success: true,
      message: "Lay profile thanh cong",
      data: profile,
    });
  } catch {
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  }
}

// PATCH /api/profile
export async function PATCH(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser) {
      return NextResponse.json({ success: false, message: "Token khong hop le" }, { status: 401 });
    }

    const hasGender = await hasTableColumn("users", "gender");
    const hasBirthYear = await hasTableColumn("users", "birth_year");

    let body: UpdateProfileBody;
    try {
      body = (await req.json()) as UpdateProfileBody;
    } catch {
      return NextResponse.json({ success: false, message: "JSON khong hop le" }, { status: 400 });
    }

    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : undefined;
    const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : undefined;
    const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
    const avatarRaw = typeof body.avatar === "string" ? body.avatar.trim() : undefined;
    const genderRaw = typeof body.gender === "string" ? body.gender.trim().toLowerCase() : undefined;
    const birthYearRaw =
      body.birth_year === null ? null : typeof body.birth_year === "number" ? body.birth_year : Number.NaN;
    const descriptionRaw = typeof body.description === "string" ? body.description.trim() : undefined;

    if (
      fullName === undefined &&
      phoneRaw === undefined &&
      emailRaw === undefined &&
      avatarRaw === undefined &&
      genderRaw === undefined &&
      (typeof birthYearRaw === "number" ? Number.isNaN(birthYearRaw) : false) &&
      descriptionRaw === undefined
    ) {
      return NextResponse.json({ success: false, message: "Khong co du lieu de cap nhat" }, { status: 400 });
    }

    if (fullName !== undefined && fullName.length === 0) {
      return NextResponse.json({ success: false, message: "full_name khong hop le" }, { status: 400 });
    }
    if (fullName !== undefined) {
      const wordCount = fullName.split(/\s+/).filter(Boolean).length;
      if (wordCount === 0 || wordCount > 50) {
        return NextResponse.json({ success: false, message: "full_name khong hop le" }, { status: 400 });
      }
    }

    if (phoneRaw !== undefined && phoneRaw !== "" && !isValidPhone(phoneRaw)) {
      return NextResponse.json({ success: false, message: "phone khong hop le" }, { status: 400 });
    }

    if (emailRaw !== undefined && (!emailRaw || !isValidEmail(emailRaw))) {
      return NextResponse.json({ success: false, message: "email khong hop le" }, { status: 400 });
    }
    if (genderRaw !== undefined && !["male", "female", ""].includes(genderRaw)) {
      return NextResponse.json({ success: false, message: "gender khong hop le" }, { status: 400 });
    }
    if (typeof birthYearRaw === "number" && !Number.isNaN(birthYearRaw)) {
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(birthYearRaw) || birthYearRaw < 1900 || birthYearRaw > currentYear) {
        return NextResponse.json({ success: false, message: "birth_year khong hop le" }, { status: 400 });
      }
    }

    const phone = phoneRaw === undefined ? undefined : phoneRaw || null;
    const email = emailRaw;
    const avatar = avatarRaw === undefined ? undefined : avatarRaw || null;
    const gender = genderRaw === undefined ? undefined : genderRaw || null;
    const birthYear =
      birthYearRaw === null ? null : typeof birthYearRaw === "number" && !Number.isNaN(birthYearRaw) ? birthYearRaw : undefined;
    const description = descriptionRaw === undefined ? undefined : descriptionRaw || null;

    const [sourceRows] = await db.execute<ProfileUpdateSourceRow[]>(
      `SELECT id, full_name, phone, email, avatar, ${
        hasGender ? "gender" : "NULL AS gender"
      }, ${hasBirthYear ? "birth_year" : "NULL AS birth_year"}
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [authUser.id]
    );

    if (sourceRows.length === 0) {
      return NextResponse.json({ success: false, message: "User khong ton tai" }, { status: 404 });
    }

    const current = sourceRows[0];
    const nextFullName = fullName !== undefined ? fullName : current.full_name;
    const nextPhone = phone !== undefined ? phone : current.phone;
    const nextEmail = email !== undefined ? email : current.email;
    const nextAvatar = avatar !== undefined ? avatar : current.avatar;
    const nextGender = gender !== undefined ? gender : current.gender;
    const nextBirthYear = birthYear !== undefined ? birthYear : current.birth_year;

    if (!nextEmail) {
      return NextResponse.json(
        { success: false, message: "Tai khoan bat buoc phai co email" },
        { status: 400 }
      );
    }
    if (!nextPhone) {
      return NextResponse.json(
        { success: false, message: "Tai khoan bat buoc phai co phone" },
        { status: 400 }
      );
    }
    if (!isValidPhone(nextPhone)) {
      return NextResponse.json(
        { success: false, message: "phone khong hop le" },
        { status: 400 }
      );
    }

    const setParts = ["full_name = ?", "phone = ?", "email = ?", "avatar = ?"];
    const updateParams: Array<string | number | null> = [nextFullName, nextPhone, nextEmail, nextAvatar];
    if (hasGender) {
      setParts.push("gender = ?");
      updateParams.push(nextGender);
    }
    if (hasBirthYear) {
      setParts.push("birth_year = ?");
      updateParams.push(nextBirthYear);
    }
    updateParams.push(authUser.id);
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE users
       SET ${setParts.join(", ")}
       WHERE id = ?`,
      updateParams
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ success: false, message: "User khong ton tai" }, { status: 404 });
    }

    if (authUser.role === "doctor" && description !== undefined) {
      await db.execute<ResultSetHeader>(
        `UPDATE doctors
         SET description = ?
         WHERE user_id = ?`,
        [description, authUser.id]
      );
    }

    return NextResponse.json({
      success: true,
      message: "Cap nhat profile thanh cong",
    });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { success: false, message: "Email hoac phone da ton tai" },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  }
}
