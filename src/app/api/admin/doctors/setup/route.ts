import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";
import { generateCode } from "@/lib/generateCode";

interface SetupDoctorBody {
  user_id: number;
  specialty_id: number;
  service_ids: number[];
}

interface ServiceRow extends RowDataPacket {
  id: number;
}

interface DoctorSetupListRow extends RowDataPacket {
  doctor_id: number;
  user_id: number;
  doctor_code: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
  username: string;
  full_name: string;
  total_services: number;
  service_ids_csv: string | null;
}

interface LeaderMapRow extends RowDataPacket {
  user_id: number;
  specialty_id: number;
  specialty_name: string | null;
}

interface LockedSpecialtyRow extends RowDataPacket {
  id: number;
  name: string;
}

async function getLockedSpecialtyForUser(
  connection: Awaited<ReturnType<typeof db.getConnection>>,
  userId: number
) {
  const [rows] = await connection.execute<LockedSpecialtyRow[]>(
    `SELECT id, name
     FROM specialties
     WHERE head_doctor_user_id = ? OR deputy_doctor_user_id = ?
     ORDER BY (head_doctor_user_id = ?) DESC, id ASC
     LIMIT 1`,
    [userId, userId, userId]
  );
  return rows.length > 0 ? rows[0] : null;
}

// GET /api/admin/doctors/setup
// Chi hien doctor da setup service hoac duoc gan truong/pho khoa.
export async function GET() {
  try {
    const [leaderMapRows] = await db.execute<LeaderMapRow[]>(
      `SELECT x.user_id, x.specialty_id, sp.name AS specialty_name
       FROM (
         SELECT head_doctor_user_id AS user_id, id AS specialty_id, 1 AS priority
         FROM specialties
         WHERE head_doctor_user_id IS NOT NULL
         UNION ALL
         SELECT deputy_doctor_user_id AS user_id, id AS specialty_id, 2 AS priority
         FROM specialties
         WHERE deputy_doctor_user_id IS NOT NULL
       ) x
       JOIN (
         SELECT user_id, MIN(priority) AS min_priority
         FROM (
           SELECT head_doctor_user_id AS user_id, 1 AS priority
           FROM specialties
           WHERE head_doctor_user_id IS NOT NULL
           UNION ALL
           SELECT deputy_doctor_user_id AS user_id, 2 AS priority
           FROM specialties
           WHERE deputy_doctor_user_id IS NOT NULL
         ) p
         GROUP BY user_id
       ) chosen ON chosen.user_id = x.user_id AND chosen.min_priority = x.priority
       LEFT JOIN specialties sp ON sp.id = x.specialty_id`
    );

    const leaderSpecialtyByUser = new Map<number, { id: number; name: string | null }>();
    leaderMapRows.forEach((row) => {
      leaderSpecialtyByUser.set(row.user_id, {
        id: row.specialty_id,
        name: row.specialty_name,
      });
    });

    const [rows] = await db.execute<DoctorSetupListRow[]>(
      `SELECT d.id AS doctor_id, d.user_id, d.doctor_code,
              d.specialty_id, sp.name AS specialty_name,
              u.phone AS username, u.full_name,
              COUNT(ds.service_id) AS total_services,
              GROUP_CONCAT(DISTINCT ds.service_id ORDER BY ds.service_id ASC) AS service_ids_csv
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN specialties sp ON sp.id = d.specialty_id
       LEFT JOIN doctor_services ds ON ds.doctor_id = d.id
       GROUP BY d.id, d.user_id, d.doctor_code, d.specialty_id, sp.name, u.phone, u.full_name
       ORDER BY d.id DESC`
    );

    const data = rows
      .map((row) => {
        const serviceIds = row.service_ids_csv
          ? row.service_ids_csv
              .split(",")
              .map((x) => Number(x))
              .filter((x) => Number.isInteger(x) && x > 0)
          : [];

        const leaderSpecialty = leaderSpecialtyByUser.get(row.user_id) ?? null;
        const finalSpecialtyId = row.specialty_id ?? leaderSpecialty?.id ?? null;
        const finalSpecialtyName = row.specialty_name ?? leaderSpecialty?.name ?? null;

        return {
          ...row,
          specialty_id: finalSpecialtyId,
          specialty_name: finalSpecialtyName,
          service_ids: serviceIds,
          _leader_specialty_id: leaderSpecialty?.id ?? null,
        };
      })
      .filter((row) => row.service_ids.length > 0 || row._leader_specialty_id !== null)
      .map(({ _leader_specialty_id: _ignore, ...row }) => row);

    return NextResponse.json({
      success: true,
      message: "Lay danh sach setup doctor thanh cong",
      data,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const connection = await db.getConnection();

  try {
    const softDeleteReady = await getServiceSoftDeleteReady();
    const body: SetupDoctorBody = await req.json();
    const { user_id, specialty_id, service_ids } = body;

    if (!user_id || !specialty_id || !Array.isArray(service_ids)) {
      return NextResponse.json(
        { success: false, message: "Du lieu khong hop le" },
        { status: 400 }
      );
    }

    const normalizedServiceIds = Array.from(
      new Set(service_ids.filter((id) => Number.isInteger(id) && id > 0))
    );

    if (normalizedServiceIds.length === 0) {
      return NextResponse.json(
        { success: false, message: "Phai chon it nhat 1 dich vu" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [userRows] = await connection.execute<RowDataPacket[]>(
      "SELECT id, role FROM users WHERE id = ? LIMIT 1",
      [user_id]
    );

    if (userRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "User khong ton tai" },
        { status: 404 }
      );
    }

    const user = userRows[0] as { id: number; role: string };
    if (user.role !== "doctor") {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "User khong phai doctor" },
        { status: 400 }
      );
    }

    const lockedSpecialty = await getLockedSpecialtyForUser(connection, user_id);
    const finalSpecialtyId = lockedSpecialty ? lockedSpecialty.id : specialty_id;

    if (lockedSpecialty && specialty_id !== lockedSpecialty.id) {
      await connection.rollback();
      return NextResponse.json(
        {
          success: false,
          message: `Bac si dang la Truong/Pho khoa ${lockedSpecialty.name}, khong duoc setup sang khoa khac`,
        },
        { status: 400 }
      );
    }

    const placeholders = normalizedServiceIds.map(() => "?").join(", ");
    const [validServices] = await connection.execute<ServiceRow[]>(
      `SELECT id FROM services
       WHERE id IN (${placeholders}) AND specialty_id = ? ${softDeleteReady ? "AND is_active = 1" : ""}`,
      [...normalizedServiceIds, finalSpecialtyId]
    );

    if (validServices.length !== normalizedServiceIds.length) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Service khong hop le voi chuyen khoa" },
        { status: 400 }
      );
    }

    const [doctorRows] = await connection.execute<RowDataPacket[]>(
      "SELECT id, doctor_code FROM doctors WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    let doctorId: number;

    if (doctorRows.length === 0) {
      const doctorCode = await generateCode(connection, "doctor");
      const [doctorResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO doctors (user_id, specialty_id, doctor_code, status)
         VALUES (?, ?, ?, 'active')`,
        [user_id, finalSpecialtyId, doctorCode]
      );
      doctorId = doctorResult.insertId;
    } else {
      const existingDoctor = doctorRows[0] as { id: number; doctor_code: string | null };
      doctorId = existingDoctor.id;

      if (!existingDoctor.doctor_code) {
        const doctorCode = await generateCode(connection, "doctor");
        await connection.execute("UPDATE doctors SET doctor_code = ? WHERE id = ?", [
          doctorCode,
          doctorId,
        ]);
      }

      await connection.execute(
        "UPDATE doctors SET specialty_id = ? WHERE id = ?",
        [finalSpecialtyId, doctorId]
      );

      await connection.execute(
        "DELETE FROM doctor_services WHERE doctor_id = ?",
        [doctorId]
      );
    }

    const values: [number, number, number][] = normalizedServiceIds.map((serviceId) => [
      doctorId,
      serviceId,
      finalSpecialtyId,
    ]);
    await connection.query(
      "INSERT INTO doctor_services (doctor_id, service_id, specialty_id) VALUES ?",
      [values]
    );

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Thiet lap bac si thanh cong",
    });
  } catch (error: unknown) {
    await connection.rollback();

    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Loi server" },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
