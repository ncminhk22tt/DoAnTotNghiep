// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";

interface ServiceRow extends RowDataPacket {
  id: number;
  name: string;
  specialty_id: number | null;
  specialty_name: string | null;
  description: string | null;
  logo_url: string | null;
}

// GET /api/public/services?specialty_id=1
export async function GET(req: NextRequest) {
  try {
    const softDeleteReady = await getServiceSoftDeleteReady();

    const specialtyIdParam = req.nextUrl.searchParams.get("specialty_id");

    let sql = `SELECT s.id, s.name, s.specialty_id, sp.name AS specialty_name, s.description, s.logo_url
               FROM services s
               LEFT JOIN specialties sp ON sp.id = s.specialty_id
               WHERE 1 = 1`;
    const params: Array<string | number> = [];

    if (specialtyIdParam) {
      const specialtyId = Number(specialtyIdParam);
      if (Number.isNaN(specialtyId) || specialtyId <= 0) {
        return NextResponse.json(
          { success: false, message: "specialty_id khong hop le" },
          { status: 400 }
        );
      }
      sql += " AND s.specialty_id = ?";
      params.push(specialtyId);
    }

    if (softDeleteReady) {
      sql += " AND s.is_active = 1";
    }

    sql += " ORDER BY s.name ASC";

    const [rows] = await db.execute<ServiceRow[]>(sql, params);

    return NextResponse.json({
      success: true,
      message: "Lay danh sach dich vu thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}


