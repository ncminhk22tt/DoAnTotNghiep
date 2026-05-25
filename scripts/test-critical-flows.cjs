const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function assertTrue(cond, message) {
  if (!cond) throw new Error(message);
}

(async () => {
  loadEnv();
  const host = process.env.DB_HOST === 'localhost' ? '127.0.0.1' : process.env.DB_HOST || '127.0.0.1';
  const dbName = process.env.DB_NAME || 'medical_booking';

  const conn = await mysql.createConnection({
    host,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 3306,
    database: dbName,
  });

  try {
    await conn.beginTransaction();

    const [doctorRows] = await conn.query("SELECT id FROM doctors ORDER BY id LIMIT 1");
    assertTrue(doctorRows.length > 0, 'Khong co doctor de test');
    const doctorId = doctorRows[0].id;

    let serviceId;
    const [doctorServiceRows] = await conn.query('SELECT service_id FROM doctor_services WHERE doctor_id = ? LIMIT 1', [doctorId]);
    if (doctorServiceRows.length > 0) {
      serviceId = doctorServiceRows[0].service_id;
    } else {
      const [serviceRows] = await conn.query('SELECT id FROM services ORDER BY id LIMIT 1');
      assertTrue(serviceRows.length > 0, 'Khong co service de test');
      serviceId = serviceRows[0].id;
      await conn.query('INSERT INTO doctor_services (doctor_id, service_id, specialty_id) VALUES (?, ?, NULL)', [doctorId, serviceId]);
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const workDate = `${yyyy}-${mm}-${dd}`;

    const [slotInsert] = await conn.query(
      `INSERT INTO doctor_schedule_slots
      (doctor_id, service_id, work_date, start_time, end_time, room, price, max_patients, booked_count, status)
      VALUES (?, ?, ?, '15:00:00', '15:30:00', 'TEST', 100000, 2, 0, 'available')`,
      [doctorId, serviceId, workDate]
    );
    const slotId = slotInsert.insertId;

    const phone = `090200${String(Date.now()).slice(-6)}`;
    const email = `${phone}@test.local`;
    const [userInsert] = await conn.query(
      "INSERT INTO users (phone, password, full_name, email, role, status) VALUES (?, 'x', 'Test Patient', ?, 'patient', 'active')",
      [phone, email]
    );
    const userId = userInsert.insertId;

    const [slotBeforeRows] = await conn.query('SELECT booked_count FROM doctor_schedule_slots WHERE id = ?', [slotId]);
    const before = slotBeforeRows[0].booked_count;

    await conn.query(
      `INSERT INTO appointments (user_id, slot_id, doctor_id, schedule_id, status, note, created_at)
       VALUES (?, ?, ?, ?, 'pending', 'test note', NOW())`,
      [userId, slotId, doctorId, slotId]
    );

    await conn.query('UPDATE doctor_schedule_slots SET booked_count = booked_count + 1 WHERE id = ?', [slotId]);

    const [slotAfterBookRows] = await conn.query('SELECT booked_count FROM doctor_schedule_slots WHERE id = ?', [slotId]);
    assertTrue(slotAfterBookRows[0].booked_count === before + 1, 'Booked_count khong tang dung khi dat lich');

    await conn.query("UPDATE appointments SET status='cancelled' WHERE user_id = ? AND slot_id = ?", [userId, slotId]);
    await conn.query('UPDATE doctor_schedule_slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = ?', [slotId]);

    const [slotAfterCancelRows] = await conn.query('SELECT booked_count FROM doctor_schedule_slots WHERE id = ?', [slotId]);
    assertTrue(slotAfterCancelRows[0].booked_count === before, 'Booked_count khong giam dung khi huy lich');

    await conn.rollback();
    console.log('PASS: test-critical-flows');
  } catch (error) {
    await conn.rollback();
    console.error('FAIL: test-critical-flows');
    throw error;
  } finally {
    await conn.end();
  }
})();
