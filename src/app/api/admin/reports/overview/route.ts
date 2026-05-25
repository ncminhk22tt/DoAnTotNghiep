// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getAuthUserFromRequest } from "@/lib/requestAuth";

interface CountRow extends RowDataPacket {
  total: number;
}

interface GroupCountRow extends RowDataPacket {
  label: string;
  total: number;
}

interface TodayCountRow extends RowDataPacket {
  pending_total: number;
  confirmed_total: number;
  completed_total: number;
  no_show_total: number;
  cancelled_total: number;
}

// GET /api/admin/reports/overview
// Bao cao tong quan: người dùng, lịch hẹn, doanh thu uoc tinh
export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser || authUser.role !== "admin") {
      return NextResponse.json(
        { success: false, message: "Chi admin moi duoc xem bao cao" },
        { status: 403 }
      );
    }

    const from = req.nextUrl.searchParams.get("from");
    const to = req.nextUrl.searchParams.get("to");
    const hasRange = Boolean(from && to);

    const [userTotalRows] = await db.execute<CountRow[]>("SELECT COUNT(*) AS total FROM users");
    const [doctorTotalRows] = await db.execute<CountRow[]>(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'doctor'"
    );
    const [patientTotalRows] = await db.execute<CountRow[]>(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'patient'"
    );

    let appointmentSql =
      "SELECT status AS label, COUNT(*) AS total FROM appointments GROUP BY status";
    const appointmentParams: Array<string> = [];
    if (hasRange) {
      appointmentSql =
        "SELECT status AS label, COUNT(*) AS total FROM appointments WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY status";
      appointmentParams.push(from as string, to as string);
    }
    const [appointmentByStatusRows] = await db.execute<GroupCountRow[]>(
      appointmentSql,
      appointmentParams
    );

    let revenueSql =
      `SELECT COALESCE(SUM(COALESCE(s.price, 0)), 0) AS total
       FROM appointments a
       LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
       WHERE a.status = 'completed'`;
    const revenueParams: Array<string> = [];
    if (hasRange) {
      revenueSql += " AND DATE(a.created_at) BETWEEN ? AND ?";
      revenueParams.push(from as string, to as string);
    }
    const [revenueRows] = await db.execute<CountRow[]>(revenueSql, revenueParams);

    const [todayRows] = await db.execute<TodayCountRow[]>(
      `SELECT
          SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) AS pending_total,
          SUM(CASE WHEN a.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_total,
          SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed_total,
          SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) AS no_show_total,
          SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_total
       FROM appointments a
       LEFT JOIN doctor_schedule_slots s ON s.id = a.slot_id
       WHERE s.work_date = CURDATE()`
    );
    const today = todayRows[0] || {
      pending_total: 0,
      confirmed_total: 0,
      completed_total: 0,
      no_show_total: 0,
      cancelled_total: 0,
    };

    return NextResponse.json({
      success: true,
      message: "Lay bao cao tong quan thanh cong",
      data: {
        users: {
          total: userTotalRows[0]?.total ?? 0,
          doctors: doctorTotalRows[0]?.total ?? 0,
          patients: patientTotalRows[0]?.total ?? 0,
        },
        appointments: appointmentByStatusRows,
        revenue_completed: revenueRows[0]?.total ?? 0,
        today_appointments: {
          pending: Number(today.pending_total || 0),
          confirmed: Number(today.confirmed_total || 0),
          completed: Number(today.completed_total || 0),
          no_show: Number(today.no_show_total || 0),
          cancelled: Number(today.cancelled_total || 0),
        },
        range: hasRange ? { from, to } : null,
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: "Loi server" }, { status: 500 });
  }
}


