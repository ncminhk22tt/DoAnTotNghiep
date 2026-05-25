// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";

type PrescriptionItemBody = {
  medicine_name?: unknown;
  dosage?: unknown;
  duration?: unknown;
};

type CreatePrescriptionBody = {
  items?: unknown;
};

interface MedicalRecordRow extends RowDataPacket {
  id: number;
}

interface PrescriptionRow extends RowDataPacket {
  id: number;
  medical_record_id: number;
}

interface PrescriptionItemRow extends RowDataPacket {
  id: number;
  prescription_id: number;
  medicine_name: string;
  dosage: string;
  duration: string;
}

function parseMedicalRecordId(id: string): number | null {
  const medicalRecordId = Number(id);
  if (!id || Number.isNaN(medicalRecordId) || medicalRecordId <= 0) return null;
  return medicalRecordId;
}

async function ensureMedicalRecordOwnedByDoctor(medicalRecordId: number, doctorId: number) {
  const [rows] = await db.execute<MedicalRecordRow[]>(
    `SELECT mr.id
     FROM medical_records mr
     JOIN appointments a ON a.id = mr.appointment_id
     LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
     WHERE mr.id = ?
       AND COALESCE(a.doctor_id, s.doctor_id) = ?
     LIMIT 1`,
    [medicalRecordId, doctorId]
  );
  return rows.length > 0;
}

// GET /api/doctor/medical-records/{id}/prescriptions
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "doctor") {
      return NextResponse.json(
        { success: false, message: "Khong dung quyen doctor" },
        { status: 403 }
      );
    }

    const doctorId = await getDoctorProfileId(authUser.id);
    if (!doctorId) {
      return NextResponse.json(
        { success: false, message: "Doctor profile khong ton tai" },
        { status: 404 }
      );
    }

    const { id } = await params;
    const medicalRecordId = parseMedicalRecordId(id);
    if (!medicalRecordId) {
      return NextResponse.json(
        { success: false, message: "medical_record_id khong hop le" },
        { status: 400 }
      );
    }

    const owned = await ensureMedicalRecordOwnedByDoctor(medicalRecordId, doctorId);
    if (!owned) {
      return NextResponse.json(
        { success: false, message: "Ho so kham benh khong ton tai" },
        { status: 404 }
      );
    }

    const [prescriptions] = await db.execute<PrescriptionRow[]>(
      "SELECT id, medical_record_id FROM prescriptions WHERE medical_record_id = ? ORDER BY id DESC",
      [medicalRecordId]
    );

    const data = [];
    for (const prescription of prescriptions) {
      const [items] = await db.execute<PrescriptionItemRow[]>(
        `SELECT id, prescription_id, medicine_name, dosage, duration
         FROM prescription_items
         WHERE prescription_id = ?
         ORDER BY id ASC`,
        [prescription.id]
      );
      data.push({ ...prescription, items });
    }

    return NextResponse.json({
      success: true,
      message: "Lay don thuoc thanh cong",
      data,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

// POST /api/doctor/medical-records/{id}/prescriptions
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();

  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "doctor") {
      return NextResponse.json(
        { success: false, message: "Khong dung quyen doctor" },
        { status: 403 }
      );
    }

    const doctorId = await getDoctorProfileId(authUser.id);
    if (!doctorId) {
      return NextResponse.json(
        { success: false, message: "Doctor profile khong ton tai" },
        { status: 404 }
      );
    }

    const { id } = await params;
    const medicalRecordId = parseMedicalRecordId(id);
    if (!medicalRecordId) {
      return NextResponse.json(
        { success: false, message: "medical_record_id khong hop le" },
        { status: 400 }
      );
    }

    let body: CreatePrescriptionBody;
    try {
      body = (await req.json()) as CreatePrescriptionBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items = rawItems
      .map((item) => item as PrescriptionItemBody)
      .map((item) => ({
        medicine_name: typeof item.medicine_name === "string" ? item.medicine_name.trim() : "",
        dosage: typeof item.dosage === "string" ? item.dosage.trim() : "",
        duration: typeof item.duration === "string" ? item.duration.trim() : "",
      }))
      .filter((item) => item.medicine_name && item.dosage && item.duration);

    if (items.length === 0) {
      return NextResponse.json(
        { success: false, message: "Phai co it nhat 1 thuoc hop le" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const owned = await ensureMedicalRecordOwnedByDoctor(medicalRecordId, doctorId);
    if (!owned) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Ho so kham benh khong ton tai" },
        { status: 404 }
      );
    }

    const [prescriptionResult] = await connection.execute<ResultSetHeader>(
      "INSERT INTO prescriptions (medical_record_id) VALUES (?)",
      [medicalRecordId]
    );

    const prescriptionId = prescriptionResult.insertId;
    const values = items.map((item) => [
      prescriptionId,
      item.medicine_name,
      item.dosage,
      item.duration,
    ]);

    await connection.query(
      `INSERT INTO prescription_items
      (prescription_id, medicine_name, dosage, duration)
      VALUES ?`,
      [values]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Tao don thuoc thanh cong",
      data: { prescription_id: prescriptionId },
    });
  } catch {
    await connection.rollback();
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
