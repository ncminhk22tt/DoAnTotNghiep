import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";

type UpdateMedicalRecordBody = {
  diagnosis?: unknown;
  notes?: unknown;
};

interface MedicalRecordRow extends RowDataPacket {
  id: number;
  appointment_id: number;
  diagnosis: string | null;
  notes: string | null;
}

interface PrescriptionRow extends RowDataPacket {
  id: number;
}

interface PrescriptionItemRow extends RowDataPacket {
  medicine_name: string | null;
  dosage: string | null;
  duration: string | null;
}

interface MedicalRecordRevisionRow extends RowDataPacket {
  id: number;
}

function parseMedicalRecordId(id: string): number | null {
  const medicalRecordId = Number(id);
  if (!id || Number.isNaN(medicalRecordId) || medicalRecordId <= 0) return null;
  return medicalRecordId;
}

async function createRevisionSnapshot(
  connection: Awaited<ReturnType<typeof db.getConnection>>,
  medicalRecordId: number,
  editorUserId: number
) {
  const [recordRows] = await connection.execute<MedicalRecordRow[]>(
    "SELECT id, appointment_id, diagnosis, notes FROM medical_records WHERE id = ? LIMIT 1",
    [medicalRecordId]
  );
  if (recordRows.length === 0) return;
  const current = recordRows[0];

  const [prescriptionRows] = await connection.execute<PrescriptionRow[]>(
    "SELECT id FROM prescriptions WHERE medical_record_id = ? ORDER BY id DESC LIMIT 1",
    [medicalRecordId]
  );

  let prescriptionJson = "[]";
  if (prescriptionRows.length > 0) {
    const prescriptionId = prescriptionRows[0].id;
    const [itemRows] = await connection.execute<PrescriptionItemRow[]>(
      `SELECT medicine_name, dosage, duration
       FROM prescription_items
       WHERE prescription_id = ?
       ORDER BY id ASC`,
      [prescriptionId]
    );
    prescriptionJson = JSON.stringify(
      itemRows.map((item) => ({
        medicine_name: item.medicine_name || "",
        dosage: item.dosage || "",
        duration: item.duration || "",
      }))
    );
  }

  await connection.execute<ResultSetHeader>(
    `INSERT INTO medical_record_revisions
    (medical_record_id, edited_by_user_id, diagnosis, notes, prescription_json)
    VALUES (?, ?, ?, ?, ?)`,
    [medicalRecordId, editorUserId, current.diagnosis, current.notes, prescriptionJson]
  );
}

async function findMedicalRecordForDoctorForUpdate(
  connection: Awaited<ReturnType<typeof db.getConnection>>,
  medicalRecordId: number,
  doctorId: number
) {
  const [rows] = await connection.execute<MedicalRecordRow[]>(
    `SELECT mr.id, mr.appointment_id, mr.diagnosis, mr.notes
     FROM medical_records mr
     JOIN appointments a ON a.id = mr.appointment_id
     LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
     WHERE mr.id = ?
       AND COALESCE(a.doctor_id, s.doctor_id) = ?
     LIMIT 1
     FOR UPDATE`,
    [medicalRecordId, doctorId]
  );
  return rows.length > 0 ? rows[0] : null;
}

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
    const medicalRecordId = parseMedicalRecordId(id);
    if (!medicalRecordId) {
      return NextResponse.json(
        { success: false, message: "medical_record_id khong hop le" },
        { status: 400 }
      );
    }

    let body: UpdateMedicalRecordBody;
    try {
      body = (await req.json()) as UpdateMedicalRecordBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const current = await findMedicalRecordForDoctorForUpdate(connection, medicalRecordId, doctorId);
    if (!current) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Ho so kham benh khong ton tai" },
        { status: 404 }
      );
    }

    const diagnosis = typeof body.diagnosis === "string" ? body.diagnosis.trim() : current.diagnosis || "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : current.notes || "";
    if (!diagnosis) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chan doan khong duoc de trong" },
        { status: 400 }
      );
    }

    const changedDiagnosis = (current.diagnosis || "") !== diagnosis;
    const changedNotes = (current.notes || "") !== notes;
    if (changedDiagnosis || changedNotes) {
      await createRevisionSnapshot(connection, medicalRecordId, authUser.id);
    }

    await connection.execute<ResultSetHeader>(
      `UPDATE medical_records
       SET diagnosis = ?, notes = ?
       WHERE id = ?`,
      [diagnosis, notes || null, medicalRecordId]
    );

    await connection.commit();
    return NextResponse.json({
      success: true,
      message: "Cap nhat ho so kham benh thanh cong",
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
    const medicalRecordId = parseMedicalRecordId(id);
    if (!medicalRecordId) {
      return NextResponse.json(
        { success: false, message: "medical_record_id khong hop le" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [recordRows] = await connection.execute<MedicalRecordRow[]>(
      `SELECT mr.id, mr.appointment_id, mr.diagnosis, mr.notes
       FROM medical_records mr
       JOIN appointments a ON a.id = mr.appointment_id
       LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
       WHERE mr.id = ?
         AND COALESCE(a.doctor_id, s.doctor_id) = ?
       FOR UPDATE`,
      [medicalRecordId, doctorId]
    );

    if (recordRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Ho so kham benh khong ton tai" },
        { status: 404 }
      );
    }

    const [prescriptionRows] = await connection.execute<PrescriptionRow[]>(
      "SELECT id FROM prescriptions WHERE medical_record_id = ?",
      [medicalRecordId]
    );

    for (const prescription of prescriptionRows) {
      await connection.execute<ResultSetHeader>(
        "DELETE FROM prescription_items WHERE prescription_id = ?",
        [prescription.id]
      );
    }

    await connection.execute<ResultSetHeader>(
      "DELETE FROM prescriptions WHERE medical_record_id = ?",
      [medicalRecordId]
    );
    await connection.execute<ResultSetHeader>(
      "DELETE FROM medical_record_revisions WHERE medical_record_id = ?",
      [medicalRecordId]
    );
    await connection.execute<ResultSetHeader>(
      "DELETE FROM medical_records WHERE id = ?",
      [medicalRecordId]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Xoa ho so kham benh thanh cong",
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
