import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { getBearerToken } from "@/lib/requestAuth";

const ALLOWED_ORIGINS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);

function buildCorsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "http://localhost:3000";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

function withCors(response: NextResponse, corsHeaders: Record<string, string>): NextResponse {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  if (
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/register") ||
    pathname.startsWith("/api/auth/forgot-password") ||
    pathname.startsWith("/api/auth/reset-password") ||
    pathname.startsWith("/api/auth/refresh") ||
    pathname.startsWith("/api/system/reminders/appointments") ||
    pathname.startsWith("/api/public/")
  ) {
    return withCors(NextResponse.next(), corsHeaders);
  }

  const token = getBearerToken(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ message: "Ban chua dang nhap" }, { status: 401, headers: corsHeaders });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return NextResponse.json({ message: "Token khong hop le" }, { status: 401, headers: corsHeaders });
  }

  if (pathname.startsWith("/api/admin") && decoded.role !== "admin") {
    return NextResponse.json({ message: "Ban khong co quyen Admin" }, { status: 403, headers: corsHeaders });
  }

  if (pathname.startsWith("/api/doctor") && decoded.role !== "doctor") {
    return NextResponse.json({ message: "Chi danh cho Bac si" }, { status: 403, headers: corsHeaders });
  }

  return withCors(NextResponse.next(), corsHeaders);
}

export const config = {
  matcher: ["/api/:path*"],
};
