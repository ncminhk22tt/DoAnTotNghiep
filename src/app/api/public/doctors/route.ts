// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";

// FILE PUBLIC READ:
// - Chi doc dữ liệu bac si (không can token).
// - Co filter theo specialty/service tu query string.

interface DoctorListRow extends RowDataPacket {
  doctor_id: number;
  user_id: number;
  doctor_code: string | null;
  full_name: string;
  avatar: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
  experience: number | null;
  description: string | null;
  total_services: number;
  rating_avg: number | null;
  rating_count: number;
}

// GET /api/public/doctors?specialty_id=1&service_id=2
export async function GET(req: NextRequest) {
  try {
    const specialtyIdParam = req.nextUrl.searchParams.get("specialty_id");
    const serviceIdParam = req.nextUrl.searchParams.get("service_id");

    // SQL goc lấy danh sach bac si dang active.
    let sql = `SELECT d.id AS doctor_id, d.user_id, d.doctor_code, u.full_name, u.avatar,
                      d.specialty_id, sp.name AS specialty_name, d.experience, d.description,
                      COUNT(DISTINCT ds.service_id) AS total_services,
                      AVG(dr.rating) AS rating_avg,
                      COUNT(DISTINCT dr.id) AS rating_count
               FROM doctors d
               JOIN users u ON u.id = d.user_id
               LEFT JOIN specialties sp ON sp.id = d.specialty_id
               LEFT JOIN doctor_services ds ON ds.doctor_id = d.id
               LEFT JOIN doctor_reviews dr ON dr.doctor_id = d.id
               WHERE u.role = 'doctor' AND u.status = 'active'`;
    const params: Array<string | number> = [];

    // Filter 1: specialty
    if (specialtyIdParam) {
      const specialtyId = Number(specialtyIdParam);
      if (Number.isNaN(specialtyId) || specialtyId <= 0) {
        return NextResponse.json(
          { success: false, message: "specialty_id khong hop le" },
          { status: 400 }
        );
      }
      sql += " AND d.specialty_id = ?";
      params.push(specialtyId);
    }

    // Filter 2: service
    if (serviceIdParam) {
      const serviceId = Number(serviceIdParam);
      if (Number.isNaN(serviceId) || serviceId <= 0) {
        return NextResponse.json(
          { success: false, message: "service_id khong hop le" },
          { status: 400 }
        );
      }
      sql += " AND EXISTS (SELECT 1 FROM doctor_services dss WHERE dss.doctor_id = d.id AND dss.service_id = ?)";
      params.push(serviceId);
    }

    sql += ` GROUP BY d.id, d.user_id, d.doctor_code, u.full_name, u.avatar,
                    d.specialty_id, sp.name, d.experience, d.description
             ORDER BY u.full_name ASC`;

    const [rows] = await db.execute<DoctorListRow[]>(sql, params);

    return NextResponse.json({
      success: true,
      message: "Lay danh sach bac si thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

