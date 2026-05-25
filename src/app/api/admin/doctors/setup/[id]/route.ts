// NOTE HỌC API:
// - Mẫu đọc nhanh: auth/validate -> query DB -> business rule -> trả JSON.
// - Nếu route có trảnsaction: nhớ beginTransaction/commit/rollback.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getServiceSoftDeleteReady } from "@/lib/serviceSchema";

type SetupDoctorBody = {
  user_id?: unknown;
  specialty_id?: unknown;
  service_ids?: unknown;
};

interface UserRow extends RowDataPacket {
  id: number;
  role: "patient" | "doctor" | "admin";
}

interface DoctorByIdRow extends RowDataPacket {
  id: number;
  user_id: number;
}

interface ServiceRow extends RowDataPacket {
  id: number;
}

interface LockedSpecialtyRow extends RowDataPacket {
  id: number;
  name: string;
}

function parseSetupBody(raw: SetupDoctorBody) {
  const userId = typeof raw.user_id === "number" ? raw.user_id : Number.NaN;
  const specialtyId =
    typeof raw.specialty_id === "number" ? raw.specialty_id : Number.NaN;

  const serviceIds = Array.isArray(raw.service_ids)
    ? raw.service_ids.filter((id): id is number => Number.isInteger(id) && id > 0)
    : [];

  return { userId, specialtyId, serviceIds };
}

async function validateServicesBySpecialty(
  serviceIds: number[],
  specialtyId: number,
  connection: Awaited<ReturnType<typeof db.getConnection>>
) {
  const softDeleteReady = await getServiceSoftDeleteReady();
  const placeholders = serviceIds.map(() => "?").join(", ");

  const [validServices] = await connection.execute<ServiceRow[]>(
    `SELECT id
     FROM services
     WHERE id IN (${placeholders}) AND specialty_id = ? ${softDeleteReady ? "AND is_active = 1" : ""}`,
    [...serviceIds, specialtyId]
  );

  return validServices.length === serviceIds.length;
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

    if (!specialtyId || Number.isNaN(specialtyId) || specialtyId <= 0) {
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

    const currentDoctor = doctorRows[0];

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
    const finalSpecialtyId = lockedSpecialty ? lockedSpecialty.id : specialtyId;

    if (lockedSpecialty && specialtyId !== lockedSpecialty.id) {
      await connection.rollback();
      return NextResponse.json(
        {
          success: false,
          message: `Bac si dang la Truong/Pho khoa ${lockedSpecialty.name}, khong duoc setup sang khoa khac`,
        },
        { status: 400 }
      );
    }

    const isServiceValid = await validateServicesBySpecialty(
      serviceIds,
      finalSpecialtyId,
      connection
    );

    if (!isServiceValid) {
      await connection.rollback();
      return NextResponse.json(
        { success: false, message: "Service khong hop le voi chuyen khoa" },
        { status: 400 }
      );
    }

    await connection.execute(
      "UPDATE doctors SET specialty_id = ? WHERE id = ?",
      [finalSpecialtyId, doctorId]
    );

    await connection.execute("DELETE FROM doctor_services WHERE doctor_id = ?", [
      doctorId,
    ]);

    const values: [number, number, number][] = serviceIds.map((serviceId) => [
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
      message: "Cap nhat setup doctor thanh cong",
      data: {
        doctor_id: doctorId,
        user_id: finalUserId,
        specialty_id: finalSpecialtyId,
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

    await connection.execute("DELETE FROM doctor_services WHERE doctor_id = ?", [
      doctorId,
    ]);
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
