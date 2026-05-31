import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { SpecialtyBody } from "@/types/specialty";
import { hasActiveScheduleForSpecialty } from "@/lib/adminScheduleGuard";

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

// PATCH /api/admin/specialties/:id
// Cập nhật chuyên khoa.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const specialtyId = Number(id);

    if (!id || Number.isNaN(specialtyId) || specialtyId <= 0) {
      return NextResponse.json(
        { success: false, message: "ID không hợp lệ" },
        { status: 400 }
      );
    }

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

    if (await hasActiveScheduleForSpecialty(specialtyId)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Không thể sửa chuyên khoa vì bác sĩ đang có lịch khám hiện tại hoặc tương lai liên quan.",
        },
        { status: 409 }
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
        `UPDATE specialties
         SET name = ?,
             description = ?,
             logo_url = ?,
             head_doctor_user_id = ?,
             deputy_doctor_user_id = ?
         WHERE id = ?`,
        [name, description, logoUrl, headDoctorUserId, deputyDoctorUserId, specialtyId]
      );
      result = queryResult;
    } else {
      const [queryResult] = await db.execute<ResultSetHeader>(
        `UPDATE specialties
         SET name = ?, description = ?, logo_url = ?
         WHERE id = ?`,
        [name, description, logoUrl, specialtyId]
      );
      result = queryResult;
    }

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, message: "Không tìm thấy chuyên khoa" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Cập nhật chuyên khoa thành công",
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

// DELETE /api/admin/specialties/:id
// Xóa chuyên khoa.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const specialtyId = Number(id);

    if (!id || Number.isNaN(specialtyId) || specialtyId <= 0) {
      return NextResponse.json(
        { success: false, message: "ID không hợp lệ" },
        { status: 400 }
      );
    }

    if (await hasActiveScheduleForSpecialty(specialtyId)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Không thể xóa chuyên khoa vì bác sĩ đang có lịch khám hiện tại hoặc tương lai liên quan.",
        },
        { status: 409 }
      );
    }

    const [result] = await db.execute<ResultSetHeader>(
      "DELETE FROM specialties WHERE id = ?",
      [specialtyId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, message: "Không tìm thấy chuyên khoa" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Xóa chuyên khoa thành công",
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Lỗi server" },
      { status: 500 }
    );
  }
}
