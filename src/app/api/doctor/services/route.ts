import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";

interface DoctorServiceRow extends RowDataPacket {
  id: number;
  name: string;
  specialty_id: number | null;
  specialty_name: string | null;
  description: string | null;
}

// GET /api/doctor/services
// Lay danh sach dich vu da duoc setup cho doctor dang dang nhap.
export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "doctor") {
      return NextResponse.json(
        { success: false, message: "Khong dung quyen doctor" },
        { status: 403 }
      );
    }

    const doctorProfileId = await getDoctorProfileId(authUser.id);
    if (!doctorProfileId) {
      return NextResponse.json(
        { success: false, message: "Doctor profile khong ton tai" },
        { status: 404 }
      );
    }

    const softDeleteReady = await getServiceSoftDeleteReady();

    const [rows] = await db.execute<DoctorServiceRow[]>(
      softDeleteReady
        ? `SELECT s.id, s.name, s.specialty_id, sp.name AS specialty_name, s.description
           FROM doctor_services ds
           JOIN services s ON s.id = ds.service_id
           LEFT JOIN specialties sp ON sp.id = s.specialty_id
           WHERE ds.doctor_id = ? AND s.is_active = 1
           GROUP BY s.id, s.name, s.specialty_id, sp.name, s.description
           ORDER BY s.name ASC`
        : `SELECT s.id, s.name, s.specialty_id, sp.name AS specialty_name, s.description
           FROM doctor_services ds
           JOIN services s ON s.id = ds.service_id
           LEFT JOIN specialties sp ON sp.id = s.specialty_id
           WHERE ds.doctor_id = ?
           GROUP BY s.id, s.name, s.specialty_id, sp.name, s.description
           ORDER BY s.name ASC`,
      [doctorProfileId]
    );

    return NextResponse.json({
      success: true,
      message: "Lay danh sach dich vu cua doctor thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

