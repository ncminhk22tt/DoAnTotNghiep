import { verifyToken, JWTPayload } from "@/lib/jwt";

// File nay chuyen 2 viec cơ bản:
// 1) Cat token tu Authorization header.
// 2) Verify token va trả user dang đăng nhập.

// Tach token tu header Authorization: Bearer <token>
export function getBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.slice(7).trim() || null;
}

// Lay user da đăng nhập tu request, sai token thi trả null
export function getAuthUserFromRequest(req: Request): JWTPayload | null {
  // Header dung dinh dang: Authorization: Bearer <token>
  const token = getBearerToken(req.headers.get("authorization"));
  if (!token) {
    return null;
  }

  return verifyToken(token);
}
