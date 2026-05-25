import jwt from "jsonwebtoken";
import { User } from "@/types/auth";

// Day la trung tam ky/xác thực JWT.
// Ban chi can nho 3 ham chinh:
// - generateToken: tao access token.
// - generateRefreshToken: tao refresh token.
// - verifyToken / verifyRefreshToken: xác thực token.

// Doc bien moi truong bat buoc cho viec ky JWT
const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_SECRET environment variable");
  }
  return secret;
})();

// Cau hinh token mac dinh
const JWT_EXPIRES_IN: jwt.SignOptions["expiresIn"] =
  (process.env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]) || "1d";
const JWT_ISSUER = process.env.JWT_ISSUER || "medical-booking";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "medical-booking-users";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET;
const JWT_REFRESH_EXPIRES_IN: jwt.SignOptions["expiresIn"] =
  (process.env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"]) || "14d";

// Du lieu can thiet de nhan dien user trong token
export type JWTPayload = Pick<User, "id" | "username" | "role">;
type RefreshPayload = JWTPayload & { token_type: "refresh"; jti: string };
const ROLES: ReadonlyArray<JWTPayload["role"]> = ["patient", "doctor", "admin"];

// Kiem trả decoded token co dung shape mong muon hay không
function isJWTPayload(value: unknown): value is JWTPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<JWTPayload>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.username === "string" &&
    typeof candidate.role === "string" &&
    ROLES.includes(candidate.role as JWTPayload["role"])
  );
}

// Tao JWT cho user sau khi đăng nhập thanh cong
export function generateToken(payload: JWTPayload) {
  // Access token: token chinh de goi API.
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: "HS256",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function generateRefreshToken(payload: JWTPayload, jti: string) {
  // Refresh token: token doi access token moi khi access het han.
  const refreshPayload: RefreshPayload = { ...payload, token_type: "refresh", jti };
  return jwt.sign(refreshPayload, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    algorithm: "HS256",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

// Xac thuc va trả payload hop le, sai thi trả null
export function verifyToken(token: string): JWTPayload | null {
  try {
    if (!token || !token.trim()) {
      return null;
    }

    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (!isJWTPayload(decoded)) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): (JWTPayload & { jti: string }) | null {
  try {
    if (!token || !token.trim()) {
      return null;
    }

    const decoded = jwt.verify(token, JWT_REFRESH_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (!decoded || typeof decoded !== "object") return null;
    // Check them token_type + jti de chan nham access token.
    const candidate = decoded as Partial<RefreshPayload>;
    const jti = typeof candidate.jti === "string" ? candidate.jti : null;
    if (candidate.token_type !== "refresh" || !jti) return null;
    if (!isJWTPayload(candidate)) return null;

    return {
      id: candidate.id,
      username: candidate.username,
      role: candidate.role,
      jti,
    };
  } catch {
    return null;
  }
}
