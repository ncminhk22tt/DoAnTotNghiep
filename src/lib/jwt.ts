import jwt from "jsonwebtoken";
import { User } from "@/types/auth";

// JWT helper trung tam. Secret duoc doc lazy de build khong fail khi env chua co.
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_SECRET environment variable");
  }
  return secret;
}

function getJwtRefreshSecret(): string {
  return process.env.JWT_REFRESH_SECRET || getJwtSecret();
}

const JWT_EXPIRES_IN: jwt.SignOptions["expiresIn"] =
  (process.env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]) || "1d";
const JWT_ISSUER = process.env.JWT_ISSUER || "medical-booking";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "medical-booking-users";
const JWT_REFRESH_EXPIRES_IN: jwt.SignOptions["expiresIn"] =
  (process.env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"]) || "14d";

export type JWTPayload = Pick<User, "id" | "username" | "role">;
type RefreshPayload = JWTPayload & { token_type: "refresh"; jti: string };
const ROLES: ReadonlyArray<JWTPayload["role"]> = ["patient", "doctor", "admin"];

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

export function generateToken(payload: JWTPayload) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: "HS256",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function generateRefreshToken(payload: JWTPayload, jti: string) {
  const refreshPayload: RefreshPayload = { ...payload, token_type: "refresh", jti };
  return jwt.sign(refreshPayload, getJwtRefreshSecret(), {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    algorithm: "HS256",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    if (!token || !token.trim()) {
      return null;
    }

    const decoded = jwt.verify(token, getJwtSecret(), {
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

    const decoded = jwt.verify(token, getJwtRefreshSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (!decoded || typeof decoded !== "object") return null;
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
