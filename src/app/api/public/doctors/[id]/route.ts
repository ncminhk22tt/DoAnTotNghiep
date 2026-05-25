import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";

interface DoctorDetailRow extends RowDataPacket {
  doctor_id: number;
  user_id: number;
  doctor_code: string | null;
  full_name: string;
  avatar: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
  experience: number | null;
  description: string | null;
  rating_avg: number | null;
  rating_count: number;
}

interface DoctorServiceRow extends RowDataPacket {
  service_id: number;
  service_name: string;
}

function parseDoctorId(id: string): number | null {
  const doctorId = Number(id);
  if (!id || Number.isNaN(doctorId) || doctorId <= 0) return null;
  return doctorId;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const softDeleteReady = await getServiceSoftDeleteReady();

    const { id } = await params;
    const doctorId = parseDoctorId(id);

    if (!doctorId) {
      return NextResponse.json(
        { success: false, message: "doctor_id khong hop le" },
        { status: 400 }
      );
    }

    const [doctorRows] = await db.execute<DoctorDetailRow[]>(
      `SELECT d.id AS doctor_id, d.user_id, d.doctor_code, u.full_name, u.avatar,
              d.specialty_id, sp.name AS specialty_name, d.experience, d.description,
              AVG(dr.rating) AS rating_avg,
              COUNT(DISTINCT dr.id) AS rating_count
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN specialties sp ON sp.id = d.specialty_id
       LEFT JOIN doctor_reviews dr ON dr.doctor_id = d.id
       WHERE d.id = ? AND u.role = 'doctor' AND u.status = 'active'
       GROUP BY d.id, d.user_id, d.doctor_code, u.full_name, u.avatar, d.specialty_id, sp.name, d.experience, d.description
       LIMIT 1`,
      [doctorId]
    );

    if (doctorRows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Bac si khong ton tai" },
        { status: 404 }
      );
    }

    const [serviceRows] = await db.execute<DoctorServiceRow[]>(
      `SELECT s.id AS service_id, s.name AS service_name
       FROM doctor_services ds
       JOIN services s ON s.id = ds.service_id
       WHERE ds.doctor_id = ? ${softDeleteReady ? "AND s.is_active = 1" : ""}
       ORDER BY s.name ASC`,
      [doctorId]
    );

    return NextResponse.json({
      success: true,
      message: "Lay chi tiet bac si thanh cong",
      data: {
        ...doctorRows[0],
        services: serviceRows,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}
