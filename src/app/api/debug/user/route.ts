import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface DebugUserRow extends RowDataPacket {
  id: number;
  phone: string;
  full_name: string;
  email: string;
  role: "patient" | "doctor" | "admin";
  status: "active" | "inactive" | "banned";
  created_at: string;
}

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone")?.trim() || "";
  const key = req.nextUrl.searchParams.get("key")?.trim() || "";
  const debugKey = process.env.DEBUG_API_KEY || "";

  if (!phone) {
    return NextResponse.json({ success: false, message: "Missing phone" }, { status: 400 });
  }

  if (!debugKey || key !== debugKey) {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  const [rows] = await db.execute<DebugUserRow[]>(
    `SELECT id, phone, full_name, email, role, status, created_at
     FROM users
     WHERE phone = ?
     LIMIT 1`,
    [phone]
  );

  if (rows.length === 0) {
    return NextResponse.json({
      success: true,
      found: false,
      data: null,
    });
  }

  return NextResponse.json({
    success: true,
    found: true,
    data: rows[0],
  });
}
