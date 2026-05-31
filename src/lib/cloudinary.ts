import { v2 as cloudinary } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
});

export async function uploadImageBuffer(
  buffer: Buffer,
  folder: string,
  fileName?: string
): Promise<string> {
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary chua duoc cau hinh");
  }

  const mimeType = fileName?.toLowerCase().endsWith(".png")
    ? "image/png"
    : fileName?.toLowerCase().endsWith(".webp")
    ? "image/webp"
    : fileName?.toLowerCase().endsWith(".gif")
    ? "image/gif"
    : "image/jpeg";

  const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: "image",
  });

  return result.secure_url;
}

export async function uploadImageBase64(
  base64: string,
  folder: string
): Promise<string> {
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary chua duoc cau hinh");
  }

  const result = await cloudinary.uploader.upload(base64, {
    folder,
    resource_type: "image",
  });

  return result.secure_url;
}

export default cloudinary;
