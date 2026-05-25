import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

type SaveBase64Input = {
  base64: string;
  originalName: string;
  folder: string;
  maxSizeBytes: number;
};

type SaveBase64Output = {
  storagePath: string;
  publicUrl: string;
  fileSize: number;
  mimeType: string | null;
};

function detectMimeByExt(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  return null;
}

export async function saveBase64File(input: SaveBase64Input): Promise<SaveBase64Output> {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.base64.trim(), "base64");
  } catch {
    throw new Error("content_base64 khong hop le");
  }

  if (!buffer.length) {
    throw new Error("Noi dung tep rong");
  }
  if (buffer.length > input.maxSizeBytes) {
    throw new Error(`Tep vuot qua ${Math.floor(input.maxSizeBytes / 1024 / 1024)}MB`);
  }

  const ext = path.extname(input.originalName || "").toLowerCase() || ".bin";
  const safeName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  const localFolder = path.join(process.cwd(), "uploads", input.folder);
  await fs.mkdir(localFolder, { recursive: true });
  const fullPath = path.join(localFolder, safeName);
  await fs.writeFile(fullPath, buffer);

  const storagePath = path.join("uploads", input.folder, safeName).replace(/\\/g, "/");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const publicUrl = `${appUrl.replace(/\/$/, "")}/${storagePath}`;

  return {
    storagePath,
    publicUrl,
    fileSize: buffer.length,
    mimeType: detectMimeByExt(input.originalName),
  };
}
