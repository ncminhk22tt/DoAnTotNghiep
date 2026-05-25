// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { getDoctorProfileId } from "@/lib/doctorProfile";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { saveBase64File } from "@/lib/storageService";

interface MedicalRecordCheckRow extends RowDataPacket {
  id: number;
}

interface FileRow extends RowDataPacket {
  id: number;
  medical_record_id: number;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string;
  created_at: string;
}

type UploadBody = {
  file_name?: unknown;
  mime_type?: unknown;
  content_base64?: unknown;
};

function parseId(id: string): number | null {
  const value = Number(id);
  if (!id || Number.isNaN(value) || value <= 0) return null;
  return value;
}

async function ensureMedicalRecordBelongsToDoctor(recordId: number, doctorId: number) {
  const [rows] = await db.execute<MedicalRecordCheckRow[]>(
    `SELECT mr.id
     FROM medical_records mr
     JOIN appointments a ON a.id = mr.appointment_id
     LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
     WHERE mr.id = ?
       AND COALESCE(a.doctor_id, s.doctor_id) = ?
     LIMIT 1`,
    [recordId, doctorId]
  );
  return rows.length > 0;
}

// GET /api/doctor/medical-records/{id}/files
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
    const recordId = parseId(id);
    if (!recordId) {
      return NextResponse.json(
        { success: false, message: "medical_record_id khong hop le" },
        { status: 400 }
      );
    }

    const owned = await ensureMedicalRecordBelongsToDoctor(recordId, doctorId);
    if (!owned) {
      return NextResponse.json(
        { success: false, message: "Ho so kham benh khong ton tai" },
        { status: 404 }
      );
    }

    const [rows] = await db.execute<FileRow[]>(
      `SELECT id, medical_record_id, file_name, mime_type, file_size, storage_path, created_at
       FROM medical_record_files
       WHERE medical_record_id = ?
       ORDER BY id DESC`,
      [recordId]
    );

    return NextResponse.json({
      success: true,
      message: "Lay danh sach tep thanh cong",
      data: rows,
    });
  } catch {
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  }
}

// POST /api/doctor/medical-records/{id}/files
// Upload kieu don gian: client gui base64
export async function POST(
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
    const recordId = parseId(id);
    if (!recordId) {
      return NextResponse.json(
        { success: false, message: "medical_record_id khong hop le" },
        { status: 400 }
      );
    }

    const owned = await ensureMedicalRecordBelongsToDoctor(recordId, doctorId);
    if (!owned) {
      return NextResponse.json(
        { success: false, message: "Ho so kham benh khong ton tai" },
        { status: 404 }
      );
    }

    let body: UploadBody;
    try {
      body = (await req.json()) as UploadBody;
    } catch {
      return NextResponse.json({ success: false, message: "JSON khong hop le" }, { status: 400 });
    }

    const fileName = typeof body.file_name === "string" ? body.file_name.trim() : "";
    const mimeType = typeof body.mime_type === "string" ? body.mime_type.trim() : null;
    const base64 = typeof body.content_base64 === "string" ? body.content_base64.trim() : "";

    if (!fileName || !base64) {
      return NextResponse.json(
        { success: false, message: "Thieu file_name hoac content_base64" },
        { status: 400 }
      );
    }

    let saved;
    try {
      saved = await saveBase64File({
        base64,
        originalName: fileName,
        folder: "medical-records",
        maxSizeBytes: 5 * 1024 * 1024,
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, message: error instanceof Error ? error.message : "Tep khong hop le" },
        { status: 400 }
      );
    }

    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO medical_record_files
       (medical_record_id, uploaded_by_user_id, file_name, mime_type, file_size, storage_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [recordId, authUser.id, fileName, mimeType || saved.mimeType, saved.fileSize, saved.storagePath]
    );

    return NextResponse.json({
      success: true,
      message: "Upload tep thanh cong",
      data: {
        id: result.insertId,
        medical_record_id: recordId,
        file_name: fileName,
        mime_type: mimeType || saved.mimeType,
        file_size: saved.fileSize,
        storage_path: saved.storagePath,
        file_url: `/api/storage/${saved.storagePath.replace(/^\/+/, "")}`,
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  }
}

