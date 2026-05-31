import { v2 as cloudinary } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
});

function assertCloudinaryConfigured() {
  const missing = [
    ["CLOUDINARY_CLOUD_NAME", cloudName],
    ["CLOUDINARY_API_KEY", apiKey],
    ["CLOUDINARY_API_SECRET", apiSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Cloudinary chua duoc cau hinh: thieu ${missing.join(", ")}`);
  }
}

export async function uploadImageBuffer(
  buffer: Buffer,
  folder: string,
  fileName?: string
): Promise<string> {
  assertCloudinaryConfigured();

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
  assertCloudinaryConfigured();

  const result = await cloudinary.uploader.upload(base64, {
    folder,
    resource_type: "image",
  });

  return result.secure_url;
}

export default cloudinary;
