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

type UpdatePrescriptionBody = {
  items?: unknown;
};

interface PrescriptionRow extends RowDataPacket {
  id: number;
  medical_record_id: number;
}

interface MedicalRecordRow extends RowDataPacket {
  id: number;
  diagnosis: string | null;
  notes: string | null;
}

interface PrescriptionItemRow extends RowDataPacket {
  medicine_name: string | null;
  dosage: string | null;
  duration: string | null;
}

function parsePrescriptionId(id: string): number | null {
  const prescriptionId = Number(id);
  if (!id || Number.isNaN(prescriptionId) || prescriptionId <= 0) return null;
  return prescriptionId;
}

async function prescriptionOwnedByDoctor(prescriptionId: number, doctorId: number) {
  const [rows] = await db.execute<PrescriptionRow[]>(
    `SELECT p.id
     FROM prescriptions p
     JOIN medical_records mr ON mr.id = p.medical_record_id
     JOIN appointments a ON a.id = mr.appointment_id
     LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
     WHERE p.id = ?
       AND COALESCE(a.doctor_id, s.doctor_id) = ?
     LIMIT 1`,
    [prescriptionId, doctorId]
  );
  return rows.length > 0;
}

async function findPrescriptionOwnedByDoctorForUpdate(
  connection: Awaited<ReturnType<typeof db.getConnection>>,
  prescriptionId: number,
  doctorId: number
) {
  const [rows] = await connection.execute<PrescriptionRow[]>(
    `SELECT p.id, p.medical_record_id
     FROM prescriptions p
     JOIN medical_records mr ON mr.id = p.medical_record_id
     JOIN appointments a ON a.id = mr.appointment_id
     LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
     WHERE p.id = ?
       AND COALESCE(a.doctor_id, s.doctor_id) = ?
     LIMIT 1
     FOR UPDATE`,
    [prescriptionId, doctorId]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function createRevisionSnapshot(
  connection: Awaited<ReturnType<typeof db.getConnection>>,
  medicalRecordId: number,
  prescriptionId: number,
  editorUserId: number
) {
  const [recordRows] = await connection.execute<MedicalRecordRow[]>(
    "SELECT id, diagnosis, notes FROM medical_records WHERE id = ? LIMIT 1",
    [medicalRecordId]
  );
  if (recordRows.length === 0) return;

  const [itemRows] = await connection.execute<PrescriptionItemRow[]>(
    `SELECT medicine_name, dosage, duration
     FROM prescription_items
     WHERE prescription_id = ?
     ORDER BY id ASC`,
    [prescriptionId]
  );

  const prescriptionJson = JSON.stringify(
    itemRows.map((item) => ({
      medicine_name: item.medicine_name || "",
      dosage: item.dosage || "",
      duration: item.duration || "",
    }))
  );

  await connection.execute<ResultSetHeader>(
    `INSERT INTO medical_record_revisions
    (medical_record_id, edited_by_user_id, diagnosis, notes, prescription_json)
    VALUES (?, ?, ?, ?, ?)`,
    [medicalRecordId, editorUserId, recordRows[0].diagnosis, recordRows[0].notes, prescriptionJson]
  );
}

// PATCH /api/doctor/prescriptions/{id}
export async function PATCH(
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
    const prescriptionId = parsePrescriptionId(id);
    if (!prescriptionId) {
      return NextResponse.json(
        { success: false, message: "prescription_id khong hop le" },
        { status: 400 }
      );
    }

    let body: UpdatePrescriptionBody;
    try {
      body = (await req.json()) as UpdatePrescriptionBody;
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

    const targetPrescription = await findPrescriptionOwnedByDoctorForUpdate(
      connection,
      prescriptionId,
      doctorId
    );
    if (!targetPrescription) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Don thuoc khong ton tai" },
        { status: 404 }
      );
    }

    await createRevisionSnapshot(
      connection,
      targetPrescription.medical_record_id,
      targetPrescription.id,
      authUser.id
    );

    await connection.execute<ResultSetHeader>(
      "DELETE FROM prescription_items WHERE prescription_id = ?",
      [prescriptionId]
    );

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
      message: "Cap nhat don thuoc thanh cong",
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

// DELETE /api/doctor/prescriptions/{id}
export async function DELETE(
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
    const prescriptionId = parsePrescriptionId(id);
    if (!prescriptionId) {
      return NextResponse.json(
        { success: false, message: "prescription_id khong hop le" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const owned = await prescriptionOwnedByDoctor(prescriptionId, doctorId);
    if (!owned) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Don thuoc khong ton tai" },
        { status: 404 }
      );
    }

    await connection.execute<ResultSetHeader>(
      "DELETE FROM prescription_items WHERE prescription_id = ?",
      [prescriptionId]
    );
    await connection.execute<ResultSetHeader>(
      "DELETE FROM prescriptions WHERE id = ?",
      [prescriptionId]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Xoa don thuoc thanh cong",
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
