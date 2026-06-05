// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getDoctorSpecialtiesReady } from "@/lib/doctorSpecialtySchema";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";

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
  specialty_ids_csv: string | null;
  specialty_names_csv: string | null;
  service_ids_csv: string | null;
  service_names_csv: string | null;
  experience: number | null;
  description: string | null;
  total_services: number;
  rating_avg: number | null;
  rating_count: number;
}

// GET /api/public/doctors?specialty_id=1&service_id=2
export async function GET(req: NextRequest) {
  try {
    const doctorSpecialtiesReady = await getDoctorSpecialtiesReady();
    const serviceSoftDeleteReady = await getServiceSoftDeleteReady();
    const specialtyIdParam = req.nextUrl.searchParams.get("specialty_id");
    const serviceIdParam = req.nextUrl.searchParams.get("service_id");
    const specialtySelect = doctorSpecialtiesReady
      ? `dsp.specialty_ids_csv, dsp.specialty_names_csv,`
      : `NULL AS specialty_ids_csv, NULL AS specialty_names_csv,`;
    const serviceJoin = `LEFT JOIN (
                         SELECT ds.doctor_id,
                                GROUP_CONCAT(DISTINCT ds.service_id ORDER BY ds.service_id ASC) AS service_ids_csv,
                                GROUP_CONCAT(DISTINCT s.name ORDER BY s.name ASC SEPARATOR '|||') AS service_names_csv
                         FROM doctor_services ds
                         LEFT JOIN services s ON s.id = ds.service_id
                         ${serviceSoftDeleteReady ? "WHERE s.is_active = 1" : ""}
                         GROUP BY ds.doctor_id
                       ) dsvc ON dsvc.doctor_id = d.id`;
    const specialtyJoin = doctorSpecialtiesReady
      ? `LEFT JOIN (
                 SELECT doctor_id,
                        GROUP_CONCAT(DISTINCT specialty_id ORDER BY specialty_id ASC) AS specialty_ids_csv,
                        GROUP_CONCAT(DISTINCT specialty_name ORDER BY specialty_name ASC SEPARATOR '|||') AS specialty_names_csv
                 FROM (
                   SELECT dspec.doctor_id,
                          dspec.specialty_id,
                          sp.name AS specialty_name
                   FROM doctor_specialties dspec
                   LEFT JOIN specialties sp ON sp.id = dspec.specialty_id
                 ) doctor_specialty_names
                 GROUP BY doctor_id
                 ) dsp ON dsp.doctor_id = d.id`
      : "";
    const groupByColumns = doctorSpecialtiesReady
      ? `d.id, d.user_id, d.doctor_code, u.full_name, u.avatar,
         d.specialty_id, sp.name, dsp.specialty_ids_csv, dsp.specialty_names_csv,
         dsvc.service_ids_csv, dsvc.service_names_csv, d.experience, d.description`
      : `d.id, d.user_id, d.doctor_code, u.full_name, u.avatar,
         d.specialty_id, sp.name, dsvc.service_ids_csv, dsvc.service_names_csv, d.experience, d.description`;

    // SQL goc lấy danh sach bac si dang active.
    let sql = `SELECT d.id AS doctor_id, d.user_id, d.doctor_code, u.full_name, u.avatar,
                      d.specialty_id, sp.name AS specialty_name, d.experience, d.description,
                      ${specialtySelect}
                      dsvc.service_ids_csv, dsvc.service_names_csv,
                      COUNT(DISTINCT ds.service_id) AS total_services,
                      AVG(dr.rating) AS rating_avg,
                      COUNT(DISTINCT dr.id) AS rating_count
               FROM doctors d
               JOIN users u ON u.id = d.user_id
               LEFT JOIN specialties sp ON sp.id = d.specialty_id
               ${specialtyJoin}
               ${serviceJoin}
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
      if (doctorSpecialtiesReady) {
        sql += " AND (d.specialty_id = ? OR EXISTS (SELECT 1 FROM doctor_specialties dspec WHERE dspec.doctor_id = d.id AND dspec.specialty_id = ?))";
        params.push(specialtyId);
        params.push(specialtyId);
      } else {
        sql += " AND d.specialty_id = ?";
        params.push(specialtyId);
      }
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

    sql += ` GROUP BY ${groupByColumns}
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

