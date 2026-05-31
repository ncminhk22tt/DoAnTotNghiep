import { NextRequest, NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { uploadImageBuffer } from "@/lib/cloudinary";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

function detectMimeByExt(fileName: string): string | null {
  const name = fileName.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "admin") {
      return NextResponse.json(
        { success: false, message: "Khong co quyen truy cap" },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: "Khong tim thay file" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, message: "File vuot qua 2MB" },
        { status: 400 }
      );
    }

    const mimeType = detectMimeByExt(file.name);
    if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { success: false, message: "Chi chap nhan file anh (png, jpg, webp, gif)" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const publicUrl = await uploadImageBuffer(buffer, "specialties", file.name);

    return NextResponse.json({
      success: true,
      message: "Upload thanh cong",
      data: { url: publicUrl },
    });
  } catch (error) {
    console.error("Specialty logo upload route failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Loi server",
      },
      { status: 500 }
    );
  }
}
