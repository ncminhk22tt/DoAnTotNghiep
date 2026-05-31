import { NextRequest, NextResponse } from "next/server";
import { db, hasTableColumn } from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";
import { getDoctorSpecialtiesReady } from "@/lib/doctorSpecialtySchema";
import { generateCode } from "@/lib/generateCode";
import {
  hasActiveScheduleForDoctorService,
  hasActiveScheduleForDoctorSpecialty,
} from "@/lib/adminScheduleGuard";

interface SetupDoctorBody {
  user_id: number;
  specialty_id?: number;
  specialty_ids?: number[];
  service_ids: number[];
}

interface DoctorSetupListRow extends RowDataPacket {
  doctor_id: number;
  user_id: number;
  doctor_code: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
  primary_specialty_id: number | null;
  primary_specialty_name: string | null;
  specialty_ids_csv: string | null;
  specialty_names_csv: string | null;
  service_specialty_ids_csv: string | null;
  service_specialty_names_csv: string | null;
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

interface ServiceDetailRow extends RowDataPacket {
  id: number;
  specialty_id: number | null;
}

interface DoctorCurrentServiceRow extends RowDataPacket {
  service_id: number;
  specialty_id: number | null;
}

function parseIdList(value: unknown) {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((id): id is number => Number.isInteger(id) && id > 0)
            .map((id) => Number(id))
        )
      )
    : [];
}

function getRequestedSpecialtyIds(body: SetupDoctorBody) {
  const listFromArray = parseIdList(body.specialty_ids);
  if (listFromArray.length > 0) return listFromArray;

  if (Number.isInteger(body.specialty_id) && (body.specialty_id || 0) > 0) {
    return [Number(body.specialty_id)];
  }

  return [];
}

function getPrimarySpecialtyId(
  specialtyIds: number[],
  lockedSpecialty: LockedSpecialtyRow | null
) {
  if (lockedSpecialty) return lockedSpecialty.id;
  return specialtyIds[0] ?? null;
}

async function syncDoctorSpecialties(
  connection: Awaited<ReturnType<typeof db.getConnection>>,
  doctorId: number,
  specialtyIds: number[],
  primarySpecialtyId: number,
  doctorSpecialtiesReady: boolean
) {
  if (!doctorSpecialtiesReady) {
    return;
  }

  await connection.execute("DELETE FROM doctor_specialties WHERE doctor_id = ?", [doctorId]);

  const values: [number, number, number][] = specialtyIds.map((specialtyId) => [
    doctorId,
    specialtyId,
    specialtyId === primarySpecialtyId ? 1 : 0,
  ]);

  if (values.length > 0) {
    await connection.query(
      "INSERT INTO doctor_specialties (doctor_id, specialty_id, is_primary) VALUES ?",
      [values]
    );
  }
}

async function getLockedSpecialtyForUser(
  connection: Awaited<ReturnType<typeof db.getConnection>>,
  userId: number
) {
  const [hasHeadColumn, hasDeputyColumn] = await Promise.all([
    hasTableColumn("specialties", "head_doctor_user_id"),
    hasTableColumn("specialties", "deputy_doctor_user_id"),
  ]);

  if (!hasHeadColumn && !hasDeputyColumn) {
    return null;
  }

  const conditions: string[] = [];
  const params: number[] = [];

  if (hasHeadColumn) {
    conditions.push("head_doctor_user_id = ?");
    params.push(userId);
  }

  if (hasDeputyColumn) {
    conditions.push("deputy_doctor_user_id = ?");
    params.push(userId);
  }

  const orderClause = hasHeadColumn ? "(head_doctor_user_id = ?) DESC, " : "";
  if (hasHeadColumn) {
    params.push(userId);
  }

  const [rows] = await connection.execute<LockedSpecialtyRow[]>(
    `SELECT id, name
     FROM specialties
     WHERE ${conditions.join(" OR ")}
     ORDER BY ${orderClause}id ASC
     LIMIT 1`,
    params
  );
  return rows.length > 0 ? rows[0] : null;
}

// GET /api/admin/doctors/setup
// Chi hien doctor da setup service hoac duoc gan truong/pho khoa.
export async function GET() {
  try {
    const doctorSpecialtiesReady = await getDoctorSpecialtiesReady();
    const [hasHeadColumn, hasDeputyColumn] = await Promise.all([
      hasTableColumn("specialties", "head_doctor_user_id"),
      hasTableColumn("specialties", "deputy_doctor_user_id"),
    ]);

    const leaderMapRows: LeaderMapRow[] = [];
    if (hasHeadColumn || hasDeputyColumn) {
      const leaderSqlParts: string[] = [];

      if (hasHeadColumn) {
        leaderSqlParts.push(
          `SELECT head_doctor_user_id AS user_id, id AS specialty_id, name AS specialty_name, 1 AS priority
           FROM specialties
           WHERE head_doctor_user_id IS NOT NULL`
        );
      }

      if (hasDeputyColumn) {
        leaderSqlParts.push(
          `SELECT deputy_doctor_user_id AS user_id, id AS specialty_id, name AS specialty_name, 2 AS priority
           FROM specialties
           WHERE deputy_doctor_user_id IS NOT NULL`
        );
      }

      const [rows] = await db.execute<LeaderMapRow[]>(
        `SELECT user_id, specialty_id, specialty_name
         FROM (
           ${leaderSqlParts.join(" UNION ALL ")}
         ) leader_rows
         ORDER BY priority ASC, specialty_id ASC`,
        []
      );

      leaderMapRows.push(...rows);
    }

    const leaderSpecialtyByUser = new Map<number, { id: number; name: string | null }>();
    leaderMapRows.forEach((row) => {
      if (!leaderSpecialtyByUser.has(row.user_id)) {
        leaderSpecialtyByUser.set(row.user_id, {
          id: row.specialty_id,
          name: row.specialty_name,
        });
      }
    });

    const specialtyJoin = doctorSpecialtiesReady
      ? `LEFT JOIN (
           SELECT dspec.doctor_id,
                  MAX(CASE WHEN dspec.is_primary = 1 THEN dspec.specialty_id END) AS primary_specialty_id,
                  MAX(CASE WHEN dspec.is_primary = 1 THEN sp.name END) AS primary_specialty_name,
                  GROUP_CONCAT(DISTINCT dspec.specialty_id ORDER BY dspec.specialty_id ASC) AS specialty_ids_csv,
                  GROUP_CONCAT(DISTINCT sp.name ORDER BY sp.name ASC SEPARATOR '|||') AS specialty_names_csv
           FROM doctor_specialties dspec
           LEFT JOIN specialties sp ON sp.id = dspec.specialty_id
           GROUP BY dspec.doctor_id
         ) dspec ON dspec.doctor_id = d.id`
      : "";

    const serviceSpecialtyJoin = `LEFT JOIN (
      SELECT ds.doctor_id,
             GROUP_CONCAT(DISTINCT s.specialty_id ORDER BY s.specialty_id ASC) AS service_specialty_ids_csv,
             GROUP_CONCAT(DISTINCT sp.name ORDER BY sp.name ASC SEPARATOR '|||') AS service_specialty_names_csv
      FROM doctor_services ds
      LEFT JOIN services s ON s.id = ds.service_id
      LEFT JOIN specialties sp ON sp.id = s.specialty_id
      GROUP BY ds.doctor_id
    ) dsvc ON dsvc.doctor_id = d.id`;

    const specialtySelect = doctorSpecialtiesReady
      ? `dspec.primary_specialty_id,
              dspec.primary_specialty_name,
              dspec.specialty_ids_csv,
              dspec.specialty_names_csv,`
      : `NULL AS primary_specialty_id,
              NULL AS primary_specialty_name,
              NULL AS specialty_ids_csv,
              NULL AS specialty_names_csv,`;

    const [rows] = await db.execute<DoctorSetupListRow[]>(
      `SELECT d.id AS doctor_id, d.user_id, d.doctor_code,
              d.specialty_id,
              sp_primary.name AS specialty_name,
              dsagg.total_services,
              dsagg.service_ids_csv,
              ${specialtySelect}
              dsvc.service_specialty_ids_csv,
              dsvc.service_specialty_names_csv,
              u.phone AS username, u.full_name
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN specialties sp_primary ON sp_primary.id = d.specialty_id
       LEFT JOIN (
         SELECT ds.doctor_id,
                COUNT(DISTINCT ds.service_id) AS total_services,
                GROUP_CONCAT(DISTINCT ds.service_id ORDER BY ds.service_id ASC) AS service_ids_csv
         FROM doctor_services ds
         GROUP BY ds.doctor_id
       ) dsagg ON dsagg.doctor_id = d.id
       ${specialtyJoin}
       ${serviceSpecialtyJoin}
       GROUP BY d.id, d.user_id, d.doctor_code, d.specialty_id, sp_primary.name,
                dsagg.total_services, dsagg.service_ids_csv,
                ${doctorSpecialtiesReady ? "dspec.primary_specialty_id, dspec.primary_specialty_name, dspec.specialty_ids_csv, dspec.specialty_names_csv," : "NULL, NULL, NULL, NULL,"}
                dsvc.service_specialty_ids_csv, dsvc.service_specialty_names_csv,
                u.phone, u.full_name
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
        const specialtyIds = row.specialty_ids_csv
          ? row.specialty_ids_csv
              .split(",")
              .map((x) => Number(x))
              .filter((x) => Number.isInteger(x) && x > 0)
          : row.specialty_id
            ? [row.specialty_id]
            : [];
        const specialtyNames = row.specialty_names_csv
          ? row.specialty_names_csv.split("|||").filter(Boolean)
          : row.specialty_name
            ? [row.specialty_name]
            : [];
        const serviceSpecialtyIds = row.service_specialty_ids_csv
          ? row.service_specialty_ids_csv
              .split(",")
              .map((x) => Number(x))
              .filter((x) => Number.isInteger(x) && x > 0)
          : [];
        const serviceSpecialtyNames = row.service_specialty_names_csv
          ? row.service_specialty_names_csv.split("|||").filter(Boolean)
          : [];
        const finalPrimarySpecialtyId =
          row.specialty_id ?? row.primary_specialty_id ?? leaderSpecialty?.id ?? null;
        const finalPrimarySpecialtyName =
          row.specialty_name ?? row.primary_specialty_name ?? leaderSpecialty?.name ?? null;
        const finalSpecialtyIds = Array.from(
          new Set([
            ...(finalPrimarySpecialtyId ? [finalPrimarySpecialtyId] : []),
            ...specialtyIds,
            ...serviceSpecialtyIds,
            ...(leaderSpecialty?.id ? [leaderSpecialty.id] : []),
          ])
        );
        const finalSpecialtyNames = Array.from(
          new Set([
            ...(finalPrimarySpecialtyName ? [finalPrimarySpecialtyName] : []),
            ...specialtyNames,
            ...serviceSpecialtyNames,
            ...(leaderSpecialty?.name ? [leaderSpecialty.name] : []),
          ])
        );

        return {
          ...row,
          specialty_id: finalPrimarySpecialtyId,
          specialty_name: finalPrimarySpecialtyName,
          specialty_ids: finalSpecialtyIds,
          specialty_names: finalSpecialtyNames,
          service_ids: serviceIds,
        };
      })
      .filter((row) => row.service_ids.length > 0 || row.specialty_ids.length > 0)
      .map((row) => row);

    return NextResponse.json({
      success: true,
      message: "Lay danh sach setup doctor thanh cong",
      data,
    });
  } catch (error) {
    console.error("GET /api/admin/doctors/setup failed:", error);
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
    const doctorSpecialtiesReady = await getDoctorSpecialtiesReady();
    const body: SetupDoctorBody = await req.json();
    const { user_id, service_ids } = body;
    const requestedSpecialtyIds = getRequestedSpecialtyIds(body);

    if (!user_id || !Array.isArray(service_ids)) {
      return NextResponse.json(
        { success: false, message: "Du lieu khong hop le" },
        { status: 400 }
      );
    }

    const normalizedServiceIds = Array.from(
      new Set(service_ids.filter((id) => Number.isInteger(id) && id > 0))
    );

    if (requestedSpecialtyIds.length === 0 || normalizedServiceIds.length === 0) {
      return NextResponse.json(
        { success: false, message: "Phai chon it nhat 1 chuyen khoa va 1 dich vu" },
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
    const finalSpecialtyIds = Array.from(
      new Set([
        ...(lockedSpecialty ? [lockedSpecialty.id] : []),
        ...requestedSpecialtyIds,
      ])
    );
    const primarySpecialtyId = getPrimarySpecialtyId(finalSpecialtyIds, lockedSpecialty);

    if (!primarySpecialtyId) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Chuyen khoa khong hop le" },
        { status: 400 }
      );
    }

    const placeholders = normalizedServiceIds.map(() => "?").join(", ");
    const [validServices] = await connection.execute<ServiceDetailRow[]>(
      `SELECT id, specialty_id FROM services
       WHERE id IN (${placeholders}) ${softDeleteReady ? "AND is_active = 1" : ""}`,
      [...normalizedServiceIds]
    );

    if (validServices.length !== normalizedServiceIds.length) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Service khong hop le" },
        { status: 400 }
      );
    }

    const specialtySet = new Set(finalSpecialtyIds);
    const invalidService = validServices.find(
      (service) => !service.specialty_id || !specialtySet.has(service.specialty_id)
    );

    if (invalidService) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Moi dich vu phai thuoc trong cac chuyen khoa da chon" },
        { status: 400 }
      );
    }

    const [doctorRows] = await connection.execute<RowDataPacket[]>(
      "SELECT id, doctor_code, specialty_id FROM doctors WHERE user_id = ? LIMIT 1",
      [user_id]
    );

    let doctorId: number;
    let currentServiceIds: number[] = [];

    if (doctorRows.length === 0) {
      const doctorCode = await generateCode(connection, "doctor");
      const [doctorResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO doctors (user_id, specialty_id, doctor_code, status)
         VALUES (?, ?, ?, 'active')`,
        [user_id, primarySpecialtyId, doctorCode]
      );
      doctorId = doctorResult.insertId;
    } else {
      const existingDoctor = doctorRows[0] as { id: number; doctor_code: string | null };
      doctorId = existingDoctor.id;

      const [currentServiceRows] = await connection.execute<RowDataPacket[]>(
        `SELECT ds.service_id, COALESCE(ds.specialty_id, s.specialty_id) AS specialty_id
         FROM doctor_services ds
         LEFT JOIN services s ON s.id = ds.service_id
         WHERE ds.doctor_id = ?`,
        [doctorId]
      );
      const currentServices = currentServiceRows as DoctorCurrentServiceRow[];
      currentServiceIds = currentServices
        .map((row) => Number(row.service_id))
        .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0);
      const currentSpecialtyIds = Array.from(
        new Set([
          ...currentServices
            .map((row) => Number(row.specialty_id))
            .filter((specialtyId) => Number.isInteger(specialtyId) && specialtyId > 0),
          ...((doctorRows[0] as { specialty_id?: unknown }).specialty_id
            ? [Number((doctorRows[0] as { specialty_id?: unknown }).specialty_id)]
            : []),
        ])
      );

      const removedServiceIds = currentServiceIds.filter(
        (serviceId) => !normalizedServiceIds.includes(serviceId)
      );
      const removedSpecialtyIds = currentSpecialtyIds.filter(
        (specialtyId) => !finalSpecialtyIds.includes(specialtyId)
      );

      for (const removedServiceId of removedServiceIds) {
        if (await hasActiveScheduleForDoctorService(doctorId, removedServiceId)) {
          await connection.rollback();
          return NextResponse.json(
            {
              success: false,
              message:
                "Khong the xoa dich vu khoi bac si vi bac si dang co lich kham hien tai hoac tuong lai lien quan.",
            },
            { status: 409 }
          );
        }
      }

      for (const removedSpecialtyId of removedSpecialtyIds) {
        if (await hasActiveScheduleForDoctorSpecialty(doctorId, removedSpecialtyId)) {
          await connection.rollback();
          return NextResponse.json(
            {
              success: false,
              message:
                "Khong the xoa chuyen khoa khoi bac si vi bac si dang co lich kham hien tai hoac tuong lai lien quan.",
            },
            { status: 409 }
          );
        }
      }

      if (!existingDoctor.doctor_code) {
        const doctorCode = await generateCode(connection, "doctor");
        await connection.execute("UPDATE doctors SET doctor_code = ? WHERE id = ?", [
          doctorCode,
          doctorId,
        ]);
      }

      await connection.execute(
        "UPDATE doctors SET specialty_id = ? WHERE id = ?",
        [primarySpecialtyId, doctorId]
      );
    }

    await syncDoctorSpecialties(
      connection,
      doctorId,
      finalSpecialtyIds,
      primarySpecialtyId,
      doctorSpecialtiesReady
    );

    await connection.execute("DELETE FROM doctor_services WHERE doctor_id = ?", [
      doctorId,
    ]);

    const values: [number, number, number][] = validServices.map((service) => [
      doctorId,
      service.id,
      service.specialty_id || primarySpecialtyId,
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
