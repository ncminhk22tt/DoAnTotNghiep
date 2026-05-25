import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { SpecialtyBody, SpecialtyRow } from "@/types/specialty";

interface ShowColumnRow extends RowDataPacket {
  Field: string;
}

async function hasLeaderColumns() {
  const [rows] = await db.execute<ShowColumnRow[]>(
    "SHOW COLUMNS FROM specialties"
  );
  const fields = new Set(rows.map((r) => r.Field));
  return (
    fields.has("head_doctor_user_id") && fields.has("deputy_doctor_user_id")
  );
}

// GET /api/admin/specialties
// Lấy danh sách chuyên khoa.
export async function GET() {
  try {
    const withLeader = await hasLeaderColumns();
    let rows: SpecialtyRow[] = [];

    if (withLeader) {
      const [queryRows] = await db.execute<SpecialtyRow[]>(
        `SELECT s.id, s.name, s.description,
                s.logo_url,
                s.head_doctor_user_id, s.deputy_doctor_user_id,
                u_head.full_name AS head_doctor_name,
                u_deputy.full_name AS deputy_doctor_name
         FROM specialties s
         LEFT JOIN users u_head ON u_head.id = s.head_doctor_user_id
         LEFT JOIN users u_deputy ON u_deputy.id = s.deputy_doctor_user_id
         ORDER BY s.id DESC`
      );
      rows = queryRows;
    } else {
      const [queryRows] = await db.execute<SpecialtyRow[]>(
        `SELECT id, name, description, logo_url
         FROM specialties
         ORDER BY id DESC`
      );
      rows = queryRows.map((r) => ({
        ...r,
        head_doctor_user_id: null,
        deputy_doctor_user_id: null,
        head_doctor_name: null,
        deputy_doctor_name: null,
      }));
    }

    return NextResponse.json({
      success: true,
      message: "Lấy danh sách chuyên khoa thành công",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Lỗi server" },
      { status: 500 }
    );
  }
}

// POST /api/admin/specialties
// Tạo chuyên khoa mới.
export async function POST(req: NextRequest) {
  try {
    let body: SpecialtyBody;

    try {
      body = (await req.json()) as SpecialtyBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON không hợp lệ" },
        { status: 400 }
      );
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : null;
    const logoUrl =
      typeof body.logo_url === "string" && body.logo_url.trim()
        ? body.logo_url.trim()
        : null;

    const headDoctorUserId =
      typeof body.head_doctor_user_id === "number" &&
      Number.isInteger(body.head_doctor_user_id) &&
      body.head_doctor_user_id > 0
        ? body.head_doctor_user_id
        : null;

    const deputyDoctorUserId =
      typeof body.deputy_doctor_user_id === "number" &&
      Number.isInteger(body.deputy_doctor_user_id) &&
      body.deputy_doctor_user_id > 0
        ? body.deputy_doctor_user_id
        : null;

    if (!name) {
      return NextResponse.json(
        { success: false, message: "Thiếu tên chuyên khoa" },
        { status: 400 }
      );
    }

    if (
      headDoctorUserId !== null &&
      deputyDoctorUserId !== null &&
      headDoctorUserId === deputyDoctorUserId
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Trưởng khoa và phó khoa không được trùng nhau",
        },
        { status: 400 }
      );
    }

    const withLeader = await hasLeaderColumns();
    let result: ResultSetHeader;

    if (withLeader) {
      const [queryResult] = await db.execute<ResultSetHeader>(
        `INSERT INTO specialties (name, description, logo_url, head_doctor_user_id, deputy_doctor_user_id)
         VALUES (?, ?, ?, ?, ?)`,
        [name, description, logoUrl, headDoctorUserId, deputyDoctorUserId]
      );
      result = queryResult;
    } else {
      const [queryResult] = await db.execute<ResultSetHeader>(
        "INSERT INTO specialties (name, description, logo_url) VALUES (?, ?, ?)",
        [name, description, logoUrl]
      );
      result = queryResult;
    }

    return NextResponse.json({
      success: true,
      message: "Tạo chuyên khoa thành công",
      data: { id: result.insertId },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { success: false, message: "Tên chuyên khoa đã tồn tại" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Lỗi server" },
      { status: 500 }
    );
  }
}
