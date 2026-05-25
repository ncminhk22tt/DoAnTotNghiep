// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextResponse } from "next/server";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { revokeAllUserRefreshTokens, revokeRefreshToken } from "@/lib/refreshToken";
import { writeAuditLog } from "@/lib/auditLog";
import { getClientIpFromHeaders } from "@/lib/rateLimit";

// POST /api/auth/logout
// Logout kieu moi: co the revoke 1 refresh token hoac tat ca session cua user.
export async function POST(req: Request) {
  const ip = getClientIpFromHeaders(req.headers);
  const userAgent = req.headers.get("user-agent");
  const authUser = getAuthUserFromRequest(req);

  try {
    let body: { refresh_token?: unknown; all_devices?: unknown } = {};
    try {
      body = (await req.json()) as { refresh_token?: unknown; all_devices?: unknown };
    } catch {
      // Khong bat buoc body.
    }

    const refreshToken =
      typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";
    const allDevices = body.all_devices === true;

    if (allDevices && authUser) {
      await revokeAllUserRefreshTokens(authUser.id);
    } else if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    } else if (authUser) {
      await revokeAllUserRefreshTokens(authUser.id);
    }

    await writeAuditLog({
      user_id: authUser?.id ?? null,
      action: "auth.logout",
      status: "success",
      ip,
      user_agent: userAgent,
      detail: allDevices ? "Dang xuat tat ca thiet bi" : "Dang xuat 1 phien",
    });
  } catch {
    // Logout van trả success de UX don gian.
  }

  return NextResponse.json({
    success: true,
    message: "Dang xuat thanh cong",
  });
}

