import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

function detectMimeByExt(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "admin") {
      return NextResponse.json(
        { success: false, message: "Không có quyền truy cập" },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: "Không tìm thấy file" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, message: "File vượt quá 2MB" },
        { status: 400 }
      );
    }

    const mimeType = detectMimeByExt(file.name);
    if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { success: false, message: "Chỉ chấp nhận file ảnh (png, jpg, webp, gif)" },
        { status: 400 }
      );
    }

    const ext = path.extname(file.name).toLowerCase() || ".jpg";
    const safeName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    const localFolder = path.join(process.cwd(), "uploads", "specialties");
    await fs.mkdir(localFolder, { recursive: true });
    const fullPath = path.join(localFolder, safeName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(fullPath, buffer);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const publicUrl = `${appUrl.replace(/\/$/, "")}/uploads/specialties/${safeName}`;

    return NextResponse.json({
      success: true,
      message: "Upload thành công",
      data: { url: publicUrl },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Lỗi server" },
      { status: 500 }
    );
  }
}
