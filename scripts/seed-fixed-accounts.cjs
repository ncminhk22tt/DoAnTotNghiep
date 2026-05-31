const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { getLocalDbConfig } = require("./db-local.cjs");

function makeEmail(role, phone) {
  return `${role}_${phone}@medical-booking.local`;
}

function makeDoctorCode(phone) {
  return `DOC${phone.slice(-6)}`;
}

async function upsertUser(conn, { phone, password, fullName, email, role }) {
  const hashedPassword = await bcrypt.hash(password, 10);

  await conn.execute(
    `INSERT INTO users (phone, password, full_name, email, role, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', NOW())
     ON DUPLICATE KEY UPDATE
       password = VALUES(password),
       full_name = VALUES(full_name),
       email = VALUES(email),
       role = VALUES(role),
       status = 'active'`,
    [phone, hashedPassword, fullName, email, role]
  );

  const [rows] = await conn.execute(
    "SELECT id FROM users WHERE phone = ? LIMIT 1",
    [phone]
  );

  return rows[0].id;
}

async function upsertDoctorProfile(conn, userId, phone) {
  const doctorCode = makeDoctorCode(phone);
  const [rows] = await conn.execute(
    "SELECT id FROM doctors WHERE user_id = ? LIMIT 1",
    [userId]
  );

  if (rows.length > 0) {
    await conn.execute(
      `UPDATE doctors
       SET specialty_id = NULL,
           experience = NULL,
           description = NULL,
           status = 'active',
           doctor_code = ?
       WHERE user_id = ?`,
      [doctorCode, userId]
    );
    return rows[0].id;
  }

  const [result] = await conn.execute(
    `INSERT INTO doctors (user_id, specialty_id, experience, description, status, doctor_code)
     VALUES (?, NULL, NULL, NULL, 'active', ?)`,
    [userId, doctorCode]
  );

  return result.insertId;
}

async function main() {
  const db = getLocalDbConfig();
  const conn = await mysql.createConnection({
    host: db.host,
    user: db.user,
    password: db.password,
    database: db.database,
    port: db.port,
  });

  try {
    await conn.beginTransaction();

    const adminPhone = "0000000001";
    const doctorPhone = "0000000011";
    const adminPassword = "0000000001";
    const doctorPassword = "0000000011";

    const adminId = await upsertUser(conn, {
      phone: adminPhone,
      password: adminPassword,
      fullName: "Admin",
      email: makeEmail("admin", adminPhone),
      role: "admin",
    });

    const doctorId = await upsertUser(conn, {
      phone: doctorPhone,
      password: doctorPassword,
      fullName: "Bac si",
      email: makeEmail("doctor", doctorPhone),
      role: "doctor",
    });

    await upsertDoctorProfile(conn, doctorId, doctorPhone);

    await conn.commit();

    console.log("Seed fixed accounts success");
    console.log(`Admin phone: ${adminPhone}, password: ${adminPassword}, user_id: ${adminId}`);
    console.log(`Doctor phone: ${doctorPhone}, password: ${doctorPassword}, user_id: ${doctorId}`);
  } catch (error) {
    await conn.rollback();
    console.error("Seed fixed accounts failed:", error.message || error);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main();
