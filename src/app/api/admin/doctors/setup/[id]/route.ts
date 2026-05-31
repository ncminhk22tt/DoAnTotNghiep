// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db, hasTableColumn } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";
import { getDoctorSpecialtiesReady } from "@/lib/doctorSpecialtySchema";
import {
  hasActiveScheduleForDoctor,
  hasActiveScheduleForDoctorService,
  hasActiveScheduleForDoctorSpecialty,
} from "@/lib/adminScheduleGuard";

type SetupDoctorBody = {
  user_id?: unknown;
  specialty_id?: unknown;
  specialty_ids?: unknown;
  service_ids?: unknown;
};

interface UserRow extends RowDataPacket {
  id: number;
  role: "patient" | "doctor" | "admin";
}

interface DoctorByIdRow extends RowDataPacket {
  id: number;
  user_id: number;
  specialty_id: number | null;
}

interface DoctorServiceIdRow extends RowDataPacket {
  service_id: number;
  specialty_id: number | null;
}

interface ServiceRow extends RowDataPacket {
  id: number;
  specialty_id: number | null;
}

interface LockedSpecialtyRow extends RowDataPacket {
  id: number;
  name: string;
}

function normalizeIdList(value: unknown) {
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

function parseSetupBody(raw: SetupDoctorBody) {
  const userId = typeof raw.user_id === "number" ? raw.user_id : Number.NaN;
  const specialtyIds = normalizeIdList(raw.specialty_ids);
  const specialtyId =
    specialtyIds.length > 0
      ? specialtyIds
      : typeof raw.specialty_id === "number" && Number.isInteger(raw.specialty_id) && raw.specialty_id > 0
        ? [raw.specialty_id]
        : [];

  const serviceIds = Array.isArray(raw.service_ids)
    ? raw.service_ids.filter((id): id is number => Number.isInteger(id) && id > 0)
    : [];

  return { userId, specialtyId, serviceIds };
}

async function validateServicesBySpecialty(
  serviceIds: number[],
  specialtyIds: number[],
  connection: Awaited<ReturnType<typeof db.getConnection>>
) {
  const softDeleteReady = await getServiceSoftDeleteReady();
  const placeholders = serviceIds.map(() => "?").join(", ");

  const [validServices] = await connection.execute<ServiceRow[]>(
    `SELECT id, specialty_id
     FROM services
     WHERE id IN (${placeholders}) ${softDeleteReady ? "AND is_active = 1" : ""}`,
    [...serviceIds]
  );

  if (validServices.length !== serviceIds.length) {
    return false;
  }

  const specialtySet = new Set(specialtyIds);
  return validServices.every((service) => service.specialty_id && specialtySet.has(service.specialty_id));
}

function parseDoctorId(id: string) {
  const doctorId = Number(id);
  if (!id || Number.isNaN(doctorId) || doctorId <= 0) return null;
  return doctorId;
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

// PUT /api/admin/doctors/setup/{id}
// Sua setup cua doctor theo doctor_id
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();

  try {
    const { id } = await params;
    const doctorId = parseDoctorId(id);

    if (!doctorId) {
      return NextResponse.json(
        { success: false, message: "doctor_id khong hop le" },
        { status: 400 }
      );
    }

    let body: SetupDoctorBody;

    try {
      body = (await req.json()) as SetupDoctorBody;
    } catch {
      return NextResponse.json(
        { success: false, message: "JSON khong hop le" },
        { status: 400 }
      );
    }

    const { userId, specialtyId, serviceIds } = parseSetupBody(body);

    if (specialtyId.length === 0) {
      return NextResponse.json(
        { success: false, message: "specialty_id khong hop le" },
        { status: 400 }
      );
    }

    if (serviceIds.length === 0) {
      return NextResponse.json(
        { success: false, message: "Phai chon it nhat 1 service" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [doctorRows] = await connection.execute<DoctorByIdRow[]>(
      "SELECT id, user_id, specialty_id FROM doctors WHERE id = ? LIMIT 1",
      [doctorId]
    );

    if (doctorRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Doctor setup khong ton tai" },
        { status: 404 }
      );
    }

    const currentDoctor = doctorRows[0];
    const [currentServiceRows] = await connection.execute<DoctorServiceIdRow[]>(
      `SELECT ds.service_id, COALESCE(ds.specialty_id, s.specialty_id) AS specialty_id
       FROM doctor_services ds
       LEFT JOIN services s ON s.id = ds.service_id
       WHERE ds.doctor_id = ?`,
      [doctorId]
    );
    const currentServiceIds = currentServiceRows
      .map((row) => row.service_id)
      .filter((serviceId) => Number.isInteger(serviceId) && serviceId > 0);
    const currentSpecialtyIds = Array.from(
      new Set([
        ...(currentDoctor.specialty_id ? [currentDoctor.specialty_id] : []),
        ...currentServiceRows
          .map((row) => row.specialty_id)
          .filter(
            (specialtyId): specialtyId is number =>
              specialtyId !== null && Number.isInteger(specialtyId) && specialtyId > 0
          ),
      ])
    );

    let finalUserId = currentDoctor.user_id;

    if (!Number.isNaN(userId) && userId > 0 && userId !== currentDoctor.user_id) {
      const [userRows] = await connection.execute<UserRow[]>(
        "SELECT id, role FROM users WHERE id = ? LIMIT 1",
        [userId]
      );

      if (userRows.length === 0) {
        await connection.rollback();
        return NextResponse.json(
          { success: false, message: "user_id khong ton tai" },
          { status: 404 }
        );
      }

      if (userRows[0].role !== "doctor") {
        await connection.rollback();
        return NextResponse.json(
          { success: false, message: "User khong phai doctor" },
          { status: 400 }
        );
      }

      await connection.execute("UPDATE doctors SET user_id = ? WHERE id = ?", [
        userId,
        doctorId,
      ]);

      finalUserId = userId;
    }

    const lockedSpecialty = await getLockedSpecialtyForUser(connection, finalUserId);
    const finalSpecialtyIds = Array.from(
      new Set([
        ...(lockedSpecialty ? [lockedSpecialty.id] : []),
        ...specialtyId,
      ])
    );
    const primarySpecialtyId = lockedSpecialty ? lockedSpecialty.id : finalSpecialtyIds[0];
    const doctorSpecialtiesReady = await getDoctorSpecialtiesReady();

    if (!primarySpecialtyId) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "chuyen khoa khong hop le" },
        { status: 400 }
      );
    }

    const isServiceValid = await validateServicesBySpecialty(
      serviceIds,
      finalSpecialtyIds,
      connection
    );

    if (!isServiceValid) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Service khong hop le voi chuyen khoa" },
        { status: 400 }
      );
    }

    const removedServiceIds = currentServiceIds.filter(
      (serviceId) => !serviceIds.includes(serviceId)
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

    await connection.execute(
      "UPDATE doctors SET specialty_id = ? WHERE id = ?",
      [primarySpecialtyId, doctorId]
    );

    if (doctorSpecialtiesReady) {
      await connection.execute("DELETE FROM doctor_specialties WHERE doctor_id = ?", [doctorId]);

      const specialtyValues: [number, number, number][] = finalSpecialtyIds.map((specialtyId) => [
        doctorId,
        specialtyId,
        specialtyId === primarySpecialtyId ? 1 : 0,
      ]);

      await connection.query(
        "INSERT INTO doctor_specialties (doctor_id, specialty_id, is_primary) VALUES ?",
        [specialtyValues]
      );
    }

    await connection.execute("DELETE FROM doctor_services WHERE doctor_id = ?", [
      doctorId,
    ]);

    const [serviceRows] = await connection.execute<ServiceRow[]>(
      `SELECT id, specialty_id
       FROM services
       WHERE id IN (${serviceIds.map(() => "?").join(", ")})`,
      [...serviceIds]
    );

    const values: [number, number, number][] = serviceRows.map((service) => [
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
      message: "Cap nhat setup doctor thanh cong",
      data: {
        doctor_id: doctorId,
        user_id: finalUserId,
        specialty_id: primarySpecialtyId,
        specialty_ids: finalSpecialtyIds,
        service_ids: serviceIds,
      },
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

// DELETE /api/admin/doctors/setup/{id}
// Xoa setup doctor theo doctor_id (không xoa user)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const connection = await db.getConnection();

  try {
    const { id } = await params;
    const doctorId = parseDoctorId(id);

    if (!doctorId) {
      return NextResponse.json(
        { success: false, message: "doctor_id khong hop le" },
        { status: 400 }
      );
    }

    await connection.beginTransaction();

    const [doctorRows] = await connection.execute<DoctorByIdRow[]>(
      "SELECT id, user_id FROM doctors WHERE id = ? LIMIT 1",
      [doctorId]
    );

    if (doctorRows.length === 0) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Doctor setup khong ton tai" },
        { status: 404 }
      );
    }

    if (await hasActiveScheduleForDoctor(doctorId)) {
      await connection.rollback();
      return NextResponse.json(
        {
          success: false,
          message:
            "Khong the xoa setup bac si vi bac si dang co lich kham hien tai hoac tuong lai.",
        },
        { status: 409 }
      );
    }

    await connection.execute("DELETE FROM doctor_services WHERE doctor_id = ?", [
      doctorId,
    ]);
    const doctorSpecialtiesReady = await getDoctorSpecialtiesReady();
    if (doctorSpecialtiesReady) {
      await connection.execute("DELETE FROM doctor_specialties WHERE doctor_id = ?", [
        doctorId,
      ]);
    }
    await connection.execute("DELETE FROM doctors WHERE id = ?", [doctorId]);

    await connection.commit();

    return NextResponse.json({
      success: true,
      message: "Xoa setup doctor thanh cong",
      data: { doctor_id: doctorId, user_id: doctorRows[0].user_id },
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
