import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";

interface MedicalRecordFileAccessRow extends RowDataPacket {
  patient_user_id: number;
  doctor_id: number | null;
}

function mimeByExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ segments: string[] }> }
) {
  try {
    const { segments } = await params;
    if (!Array.isArray(segments) || segments.length === 0) {
      return NextResponse.json({ success: false, message: "Duong dan khong hop le" }, { status: 400 });
    }

    const rootDir = path.join(process.cwd(), "uploads");
    const parts = segments[0] === "uploads" ? segments.slice(1) : segments;
    const safeParts = parts.map((x) => x.replace(/\.\./g, "").replace(/^\/+/, ""));
    const fullPath = path.join(rootDir, ...safeParts);
    const resolved = path.resolve(fullPath);
    const allowed = path.resolve(rootDir);
    const relativePath = path.relative(allowed, resolved).replace(/\\/g, "/");
    const storagePath = `uploads/${relativePath}`;

    if (!resolved.startsWith(allowed)) {
      return NextResponse.json({ success: false, message: "Khong co quyen truy cap tep" }, { status: 403 });
    }

    const folder = safeParts[0]?.toLowerCase() || "";

    // Avatars are public assets. Medical files must be authorized by ownership/role.
    if (folder === "medical-records") {
      const authUser = getAuthUserFromRequest(req);
      if (!authUser) {
        return NextResponse.json({ success: false, message: "Ban chua dang nhap" }, { status: 401 });
      }

      const [rows] = await db.execute<MedicalRecordFileAccessRow[]>(
        `SELECT a.user_id AS patient_user_id, COALESCE(a.doctor_id, s.doctor_id) AS doctor_id
         FROM medical_record_files mrf
         JOIN medical_records mr ON mr.id = mrf.medical_record_id
         JOIN appointments a ON a.id = mr.appointment_id
         LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
         WHERE mrf.storage_path = ?
         LIMIT 1`,
        [storagePath]
      );

      if (rows.length === 0) {
        return NextResponse.json({ success: false, message: "Khong tim thay tep" }, { status: 404 });
      }

      const access = rows[0];
      let canRead = authUser.role === "admin";

      if (!canRead && authUser.role === "patient") {
        canRead = access.patient_user_id === authUser.id;
      }

      if (!canRead && authUser.role === "doctor") {
        const [doctorRows] = await db.execute<RowDataPacket[]>(
          "SELECT id FROM doctors WHERE user_id = ? LIMIT 1",
          [authUser.id]
        );
        const doctorProfileId = Number(doctorRows[0]?.id || 0);
        canRead = doctorProfileId > 0 && access.doctor_id === doctorProfileId;
      }

      if (!canRead) {
        return NextResponse.json({ success: false, message: "Khong co quyen truy cap tep" }, { status: 403 });
      }
    }

    const fileBuffer = await fs.readFile(resolved);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": mimeByExtension(resolved),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: "Khong tim thay tep" }, { status: 404 });
  }
}
