import { v2 as cloudinary } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const isConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

export function isCloudinaryConfigured() {
  return isConfigured;
}

function ensureConfigured() {
  if (!isConfigured) {
    const missing = [
      ["CLOUDINARY_CLOUD_NAME", cloudName],
      ["CLOUDINARY_API_KEY", apiKey],
      ["CLOUDINARY_API_SECRET", apiSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    throw new Error(`Cloudinary chua duoc cau hinh: thieu ${missing.join(", ")}`);
  }
}

export async function uploadImageBuffer(buffer: Buffer, folder = "medical-booking") {
  ensureConfigured();

  const dataUri = `data:image/png;base64,${buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
  });
  return result.secure_url;
}

export async function uploadImageBase64(base64: string, folder = "medical-booking") {
  ensureConfigured();

  const result = await cloudinary.uploader.upload(base64, {
    folder,
  });
  return result.secure_url;
}

export default cloudinary;
