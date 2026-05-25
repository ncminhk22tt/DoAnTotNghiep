// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthUserFromRequest } from "@/lib/requestAuth";
import { RowDataPacket } from "mysql2";
import { ensureAuditLogTable } from "@/lib/auditLogSchema";

interface AuditLogRow extends RowDataPacket {
  id: number;
  user_id: number | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  status: "success" | "failed";
  ip_address: string | null;
  user_agent: string | null;
  detail: string | null;
  created_at: string;
}

// GET /api/admin/audit-logs
export async function GET(req: NextRequest) {
  try {
    await ensureAuditLogTable();
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "admin") {
      return NextResponse.json(
        { success: false, message: "Chỉ admin mới được xem nhật ký hệ thống" },
        { status: 403 }
      );
    }

    const action = req.nextUrl.searchParams.get("action");
    const status = req.nextUrl.searchParams.get("status");
    const userIdParam = req.nextUrl.searchParams.get("user_id");
    const dateFrom = req.nextUrl.searchParams.get("date_from");
    const dateTo = req.nextUrl.searchParams.get("date_to");
    const limitParam = Number(req.nextUrl.searchParams.get("limit") || 50);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    let sql =
      `SELECT id, user_id, action, entity_type, entity_id, status, ip_address, user_agent, detail, created_at
       FROM audit_logs
       WHERE 1 = 1`;
    const params: Array<string | number> = [];

    if (action) {
      sql += " AND action = ?";
      params.push(action);
    }

    if (status && ["success", "failed"].includes(status)) {
      sql += " AND status = ?";
      params.push(status);
    }

    if (userIdParam) {
      const userId = Number(userIdParam);
      if (!Number.isFinite(userId) || userId <= 0) {
        return NextResponse.json(
          { success: false, message: "user_id không hợp lệ" },
          { status: 400 }
        );
      }
      sql += " AND user_id = ?";
      params.push(userId);
    }

    if (dateFrom && dateTo) {
      sql += " AND DATE(created_at) BETWEEN ? AND ?";
      params.push(dateFrom, dateTo);
    } else if (dateFrom) {
      sql += " AND DATE(created_at) >= ?";
      params.push(dateFrom);
    } else if (dateTo) {
      sql += " AND DATE(created_at) <= ?";
      params.push(dateTo);
    }

    sql += ` ORDER BY id DESC LIMIT ${limit}`;

    const [rows] = await db.execute<AuditLogRow[]>(sql, params);

    return NextResponse.json({
      success: true,
      message: "Lấy nhật ký hệ thống thành công",
      data: rows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        message: err instanceof Error ? err.message : "Loi server",
      },
      { status: 500 }
    );
  }
}


