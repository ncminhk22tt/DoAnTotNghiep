// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { ServiceBody, ServiceRow } from "@/types/service";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";

// FILE CRUD CƠ BẢN (ADMIN):
// - GET: doc danh sach.
// - POST: tao moi.
// Hai buoc can nho: validate input -> query DB.

interface IdRow extends RowDataPacket {
  id: number;
}

// GET /api/admin/services
// Lay danh sach dịch vụ kem ten chuyên khoa
export async function GET() {
  try {
    const softDeleteReady = await getServiceSoftDeleteReady();

    const [rows] = await db.execute<ServiceRow[]>(
      `SELECT s.id, s.name, s.specialty_id, sp.name AS specialty_name, s.description, s.logo_url
       FROM services s
       LEFT JOIN specialties sp ON sp.id = s.specialty_id
       ${softDeleteReady ? "WHERE s.is_active = 1" : ""}
       ORDER BY s.id DESC`
    );

    return NextResponse.json({
      success: true,
      message: "Lay danh sach dich vu thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  }
}

// POST /api/admin/services
// Tao dịch vụ moi va gan specialty_id
export async function POST(req: NextRequest) {
  try {
    const softDeleteReady = await getServiceSoftDeleteReady();

    let body: ServiceBody;

    try {
      body = (await req.json()) as ServiceBody;
    } catch {
      return NextResponse.json({ success: false, message: "JSON khong hop le" }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const specialtyId = typeof body.specialty_id === "number" ? body.specialty_id : Number.NaN;
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const logoUrl =
      typeof body.logo_url === "string" && body.logo_url.trim()
        ? body.logo_url.trim()
        : null;

    if (!name || Number.isNaN(specialtyId) || specialtyId <= 0) {
      return NextResponse.json({ success: false, message: "Du lieu khong hop le" }, { status: 400 });
    }

    // Rule nghiệp vụ cơ bản: service phai thuoc 1 specialty co that.
    const [specialtyRows] = await db.execute<IdRow[]>(
      "SELECT id FROM specialties WHERE id = ?",
      [specialtyId]
    );

    if (specialtyRows.length === 0) {
      return NextResponse.json({ success: false, message: "specialty_id khong ton tai" }, { status: 400 });
    }

    const [result] = softDeleteReady
      ? await db.execute<ResultSetHeader>(
          `INSERT INTO services (name, specialty_id, description, is_active, deleted_at)
           VALUES (?, ?, ?, ?, 1, NULL)`,
          [name, specialtyId, description, logoUrl]
        )
      : await db.execute<ResultSetHeader>(
          "INSERT INTO services (name, specialty_id, description, logo_url) VALUES (?, ?, ?, ?)",
          [name, specialtyId, description, logoUrl]
        );

    return NextResponse.json({
      success: true,
      message: "Tao dich vu thanh cong",
      data: { id: result.insertId },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      return NextResponse.json({ success: false, message: "Dich vu da ton tai" }, { status: 409 });
    }

    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  }
}

