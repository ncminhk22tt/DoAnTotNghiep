import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ScheduleSlot } from "@/types/slot";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const doctorId = Number(id);
    const date = req.nextUrl.searchParams.get("date");
    const serviceIdParam = req.nextUrl.searchParams.get("service_id");

    if (!doctorId || !date) {
      return NextResponse.json(
        { success: false, message: "Thieu du lieu" },
        { status: 400 }
      );
    }

    let sql = `SELECT id, service_id, DATE_FORMAT(work_date, '%Y-%m-%d') AS work_date, start_time, end_time, price, room, status
               FROM doctor_schedule_slots
               WHERE doctor_id = ?
               AND work_date = ?`;
    const sqlParams: Array<string | number> = [doctorId, date];

    if (serviceIdParam) {
      const serviceId = Number(serviceIdParam);
      if (Number.isNaN(serviceId) || serviceId <= 0) {
        return NextResponse.json(
          { success: false, message: "service_id khong hop le" },
          { status: 400 }
        );
      }
      sql += " AND service_id = ?";
      sqlParams.push(serviceId);
    }

    sql += " ORDER BY start_time";

    const [rows] = await db.execute<ScheduleSlot[]>(sql, sqlParams);

    return NextResponse.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("GET /api/public/doctors/[id]/schedule failed:", error);
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}
