const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

async function getOrCreateSpecialty(conn, name, description) {
  const [existing] = await conn.execute(
    "SELECT id FROM specialties WHERE name = ? ORDER BY id ASC LIMIT 1",
    [name]
  );
  if (existing.length > 0) {
    return existing[0].id;
  }

  const [result] = await conn.execute(
    "INSERT INTO specialties (name, description) VALUES (?, ?)",
    [name, description]
  );
  return result.insertId;
}

async function upsertService(conn, item) {
  await conn.execute(
    `INSERT INTO services (name, specialty_id, description, is_active, deleted_at)
     VALUES (?, ?, ?, 1, NULL)
     ON DUPLICATE KEY UPDATE
       specialty_id = VALUES(specialty_id),
       description = VALUES(description),
       is_active = 1,
       deleted_at = NULL`,
    [item.name, item.specialtyId, item.description]
  );

  const [rows] = await conn.execute(
    "SELECT id FROM services WHERE name = ? LIMIT 1",
    [item.name]
  );
  return rows[0].id;
}

async function upsertDoctorUser(conn, item, hashedPassword) {
  await conn.execute(
    `INSERT INTO users (password, full_name, email, phone, role, status, created_at)
     VALUES (?, ?, ?, ?, 'doctor', 'active', NOW())
     ON DUPLICATE KEY UPDATE
       password = VALUES(password),
       full_name = VALUES(full_name),
       email = VALUES(email),
       phone = VALUES(phone),
       role = 'doctor',
       status = 'active'`,
    [hashedPassword, item.fullName, item.email, item.phone]
  );

  const [rows] = await conn.execute(
    "SELECT id FROM users WHERE phone = ? LIMIT 1",
    [item.phone]
  );
  return rows[0].id;
}

async function upsertDoctorProfile(conn, item) {
  const [rows] = await conn.execute(
    "SELECT id, doctor_code FROM doctors WHERE user_id = ? LIMIT 1",
    [item.userId]
  );

  if (rows.length > 0) {
    const doctorId = rows[0].id;
    await conn.execute(
      `UPDATE doctors
       SET specialty_id = ?, experience = ?, description = ?, status = 'active'
       WHERE id = ?`,
      [item.specialtyId, item.experience, item.description, doctorId]
    );
    return doctorId;
  }

  try {
    const [result] = await conn.execute(
      `INSERT INTO doctors (user_id, specialty_id, experience, description, status, doctor_code)
       VALUES (?, ?, ?, ?, 'active', ?)`,
      [item.userId, item.specialtyId, item.experience, item.description, item.doctorCode]
    );
    return result.insertId;
  } catch (error) {
    if (error && error.code === "ER_DUP_ENTRY") {
      const fallbackCode = `${item.doctorCode}-${Date.now().toString().slice(-4)}`;
      const [result] = await conn.execute(
        `INSERT INTO doctors (user_id, specialty_id, experience, description, status, doctor_code)
         VALUES (?, ?, ?, ?, 'active', ?)`,
        [item.userId, item.specialtyId, item.experience, item.description, fallbackCode]
      );
      return result.insertId;
    }
    throw error;
  }
}

async function main() {
  loadEnvLocal();

  const host =
    process.env.DB_HOST === "localhost"
      ? "127.0.0.1"
      : process.env.DB_HOST || "127.0.0.1";

  const conn = await mysql.createConnection({
    host,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "medical_booking",
    port: Number(process.env.DB_PORT) || 3306,
  });

  try {
    const specialtyNames = [
      "Noi tong quat",
      "Ngoai tong quat",
      "San phu khoa",
      "Nhi khoa",
      "Mat",
      "Tai mui hong",
      "Da lieu",
      "Tim mach",
      "Than - Tiet nieu",
      "Than kinh",
      "Noi tiet",
      "Ho hap",
      "Tieu hoa",
      "Co xuong khop",
      "Phuc hoi chuc nang",
      "Tam ly",
      "Y hoc co truyen",
      "Nha khoa",
      "Chan doan hinh anh",
      "Xet nghiem",
    ];

    const specialtyIds = [];
    for (let i = 0; i < specialtyNames.length; i += 1) {
      const name = specialtyNames[i];
      const id = await getOrCreateSpecialty(
        conn,
        name,
        `Chuyen khoa ${name} - du lieu demo do an tot nghiep`
      );
      specialtyIds.push(id);
    }

    const serviceTemplates = [
      "Kham tong quat",
      "Kham noi chuyen sau",
      "Kham ngoai chuyen sau",
      "Kham san dinh ky",
      "Kham nhi tong quat",
      "Kham mat tong quat",
      "Kham tai mui hong",
      "Kham da lieu",
      "Sieu am tong quat",
      "Dien tim ECG",
      "Noi soi tieu hoa",
      "Do ho hap ky",
      "Kiem tra duong huyet",
      "Xet nghiem mau co ban",
      "Xet nghiem nuoc tieu",
      "Kham co xuong khop",
      "Vat ly tri lieu",
      "Tu van tam ly",
      "Kham rang ham mat",
      "Tam soat ung thu co ban",
    ];

    const serviceIds = [];
    for (let i = 0; i < serviceTemplates.length; i += 1) {
      const specialtyId = specialtyIds[i % specialtyIds.length];
      const serviceName = `[Demo] ${serviceTemplates[i]} ${pad2(i + 1)}`;
      const serviceId = await upsertService(conn, {
        name: serviceName,
        specialtyId,
        description: `${serviceTemplates[i]} - goi demo cho khoa so ${specialtyId}`,
      });
      serviceIds.push(serviceId);
    }

    const hashedPassword = await bcrypt.hash("123456", 10);

    for (let i = 0; i < 20; i += 1) {
      const no = pad2(i + 1);
      const specialtyId = specialtyIds[i % specialtyIds.length];
      const primaryServiceId = serviceIds[i % serviceIds.length];
      const secondaryServiceId = serviceIds[(i + 5) % serviceIds.length];

      const userId = await upsertDoctorUser(
        conn,
        {
          fullName: `BS. Demo ${no}`,
          email: `doctor_demo_${no}@smarthealth.local`,
          phone: `090100${String(i + 1).padStart(4, "0")}`,
        },
        hashedPassword
      );

      const doctorId = await upsertDoctorProfile(conn, {
        userId,
        specialtyId,
        experience: 4 + (i % 12),
        description: `Bac si demo ${no}, kinh nghiem kham chua benh da khoa.`,
        doctorCode: `BSD${String(i + 1).padStart(3, "0")}`,
      });

      await conn.execute("DELETE FROM doctor_services WHERE doctor_id = ?", [doctorId]);
      await conn.execute(
        `INSERT IGNORE INTO doctor_services (doctor_id, service_id, specialty_id)
         VALUES (?, ?, ?), (?, ?, ?)`,
        [doctorId, primaryServiceId, specialtyId, doctorId, secondaryServiceId, specialtyId]
      );
    }

    const [[specialtyCountRow]] = await conn.query(
      "SELECT COUNT(*) AS total FROM specialties"
    );
    const [[serviceCountRow]] = await conn.query(
      "SELECT COUNT(*) AS total FROM services WHERE is_active = 1"
    );
    const [[doctorCountRow]] = await conn.query(
      "SELECT COUNT(*) AS total FROM doctors"
    );

    console.log("Seed demo data thanh cong.");
    console.log(`Tong specialties: ${specialtyCountRow.total}`);
    console.log(`Tong active services: ${serviceCountRow.total}`);
    console.log(`Tong doctors: ${doctorCountRow.total}`);
    console.log("Tai khoan doctor demo mat khau mac dinh: 123456");
    console.log("Phone mau: 0901000001 ... 0901000020");
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("Seed demo data that bai:", error?.message || error);
  process.exit(1);
});

