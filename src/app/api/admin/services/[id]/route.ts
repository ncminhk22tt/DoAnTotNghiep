import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { ServiceBody } from "@/types/service";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";
import { hasActiveScheduleForService } from "@/lib/adminScheduleGuard";

interface IdRow extends RowDataPacket {
  id: number;
}

// PATCH /api/admin/services/:id
// Sua dich vu, cho phep cap nhat ca chuyen khoa.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const softDeleteReady = await getServiceSoftDeleteReady();

    const { id } = await params;
    const serviceId = Number(id);

    if (!id || Number.isNaN(serviceId) || serviceId <= 0) {
      return NextResponse.json(
        { success: false, message: "ID không hợp lệ" },
        { status: 400 }
      );
    }

    let body: ServiceBody;
    try {
      body = (await req.json()) as ServiceBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON không hợp lệ" },
        { status: 400 }
      );
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const specialtyId =
      typeof body.specialty_id === "number" ? body.specialty_id : Number.NaN;
    const description =
      typeof body.description === "string" ? body.description.trim() : null;
    const logoUrl =
      typeof body.logo_url === "string" && body.logo_url.trim()
        ? body.logo_url.trim()
        : null;

    if (!name || Number.isNaN(specialtyId) || specialtyId <= 0) {
      return NextResponse.json(
        { success: false, message: "Dữ liệu không hợp lệ" },
        { status: 400 }
      );
    }

    if (await hasActiveScheduleForService(serviceId)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Không thể sửa dịch vụ vì bác sĩ đang có lịch khám hiện tại hoặc tương lai liên quan.",
        },
        { status: 409 }
      );
    }

    const [specialtyRows] = await db.execute<IdRow[]>(
      "SELECT id FROM specialties WHERE id = ?",
      [specialtyId]
    );

    if (specialtyRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Chuyên khoa không tồn tại" },
        { status: 400 }
      );
    }

    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE services SET name = ?, specialty_id = ?, description = ?, logo_url = ?
       WHERE id = ? ${softDeleteReady ? "AND is_active = 1" : ""}`,
      [name, specialtyId, description, logoUrl, serviceId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, message: "Không tìm thấy dịch vụ" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Cập nhật dịch vụ thành công",
    });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { success: false, message: "Dịch vụ đã tồn tại" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Lỗi server" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/services/:id
// Soft delete: danh dau ngung hoat dong thay vi xoa vat ly.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const softDeleteReady = await getServiceSoftDeleteReady();

    const { id } = await params;
    const serviceId = Number(id);

    if (!id || Number.isNaN(serviceId) || serviceId <= 0) {
      return NextResponse.json(
        { success: false, message: "ID không hợp lệ" },
        { status: 400 }
      );
    }

    if (await hasActiveScheduleForService(serviceId)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Không thể xóa dịch vụ vì bác sĩ đang có lịch khám hiện tại hoặc tương lai liên quan.",
        },
        { status: 409 }
      );
    }

    const [result] = softDeleteReady
      ? await db.execute<ResultSetHeader>(
          `UPDATE services
           SET is_active = 0, deleted_at = NOW()
           WHERE id = ? AND is_active = 1`,
          [serviceId]
        )
      : await db.execute<ResultSetHeader>(
          "DELETE FROM services WHERE id = ?",
          [serviceId]
        );

    if (result.affectedRows === 0) {
      const [existRows] = await db.execute<IdRow[]>(
        "SELECT id FROM services WHERE id = ? LIMIT 1",
        [serviceId]
      );

      if (softDeleteReady && existRows.length > 0) {
        return NextResponse.json(
          { success: false, message: "Dịch vụ đã ngừng hoạt động trước đó" },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { success: false, message: "Không tìm thấy dịch vụ" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: softDeleteReady
        ? "Ngừng hoạt động dịch vụ thành công"
        : "Xóa dịch vụ thành công",
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ER_ROW_IS_REFERENCED_2" || code === "ER_ROW_IS_REFERENCED") {
      return NextResponse.json(
        {
          success: false,
          message:
            "Không thể xóa dịch vụ vì đang được sử dụng trong hệ thống (lịch làm việc hoặc phân công bác sĩ).",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Lỗi server" },
      { status: 500 }
    );
  }
}
