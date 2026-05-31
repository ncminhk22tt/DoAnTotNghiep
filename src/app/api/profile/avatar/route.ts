import { NextRequest, NextResponse } from "next/server";
import { ResultSetHeader } from "mysql2";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { uploadImageBase64 } from "@/lib/cloudinary";

type UploadAvatarBody = {
  file_name?: unknown;
  content_base64?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser) {
      return NextResponse.json({ success: false, message: "Token khong hop le" }, { status: 401 });
    }

    let body: UploadAvatarBody;
    try {
      body = (await req.json()) as UploadAvatarBody;
    } catch {
      return NextResponse.json({ success: false, message: "JSON khong hop le" }, { status: 400 });
    }

    const fileName = typeof body.file_name === "string" ? body.file_name.trim() : "";
    const base64 = typeof body.content_base64 === "string" ? body.content_base64.trim() : "";
    if (!fileName || !base64) {
      return NextResponse.json(
        { success: false, message: "Thieu file_name hoac content_base64" },
        { status: 400 }
      );
    }

    const ext = fileName.toLowerCase();
    if (!ext.endsWith(".png") && !ext.endsWith(".jpg") && !ext.endsWith(".jpeg") && !ext.endsWith(".webp")) {
      return NextResponse.json(
        { success: false, message: "Avatar chi ho tro png/jpg/jpeg/webp" },
        { status: 400 }
      );
    }

    let avatarUrl: string;
    try {
      avatarUrl = await uploadImageBase64(base64, "avatars");
    } catch (error) {
      return NextResponse.json(
        { success: false, message: error instanceof Error ? error.message : "Tep khong hop le" },
        { status: 400 }
      );
    }

    await db.execute<ResultSetHeader>(`UPDATE users SET avatar = ? WHERE id = ?`, [
      avatarUrl,
      authUser.id,
    ]);

    return NextResponse.json({
      success: true,
      message: "Upload avatar thanh cong",
      data: {
        avatar: avatarUrl,
        avatar_url: avatarUrl,
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  }
}
