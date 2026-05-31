import { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";

interface ClinicNow {
  date: string;
  time: string;
}

function getClinicNow(): ClinicNow {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return {
    date: `${byType.get("year") || "0000"}-${byType.get("month") || "00"}-${byType.get("day") || "00"}`,
    time: `${byType.get("hour") || "00"}:${byType.get("minute") || "00"}:${byType.get("second") || "00"}`,
  };
}

interface ExistsRow extends RowDataPacket {
  id: number;
}

function activeScheduleSql() {
  const now = getClinicNow();
  return {
    where: "(work_date > ? OR (work_date = ? AND end_time > ?))",
    params: [now.date, now.date, now.time] as const,
  };
}

export async function hasActiveScheduleForService(serviceId: number) {
  const active = activeScheduleSql();
  const [rows] = await db.query<ExistsRow[]>(
    `SELECT id
     FROM doctor_schedule_slots
     WHERE service_id = ?
       AND ${active.where}
     LIMIT 1`,
    [serviceId, ...active.params]
  );
  return rows.length > 0;
}

export async function hasActiveScheduleForDoctorService(doctorId: number, serviceId: number) {
  const active = activeScheduleSql();
  const [rows] = await db.query<ExistsRow[]>(
    `SELECT id
     FROM doctor_schedule_slots
     WHERE doctor_id = ?
       AND service_id = ?
       AND ${active.where}
     LIMIT 1`,
    [doctorId, serviceId, ...active.params]
  );
  return rows.length > 0;
}

export async function hasActiveScheduleForDoctorSpecialty(doctorId: number, specialtyId: number) {
  const active = activeScheduleSql();
  const [rows] = await db.query<ExistsRow[]>(
    `SELECT dss.id
     FROM doctor_schedule_slots dss
     LEFT JOIN services s ON s.id = dss.service_id
     LEFT JOIN doctor_services ds
       ON ds.doctor_id = dss.doctor_id
      AND ds.service_id = dss.service_id
     WHERE dss.doctor_id = ?
       AND (s.specialty_id = ? OR ds.specialty_id = ?)
       AND ${active.where}
     LIMIT 1`,
    [doctorId, specialtyId, specialtyId, ...active.params]
  );
  return rows.length > 0;
}

export async function hasActiveScheduleForDoctor(doctorId: number) {
  const active = activeScheduleSql();
  const [rows] = await db.query<ExistsRow[]>(
    `SELECT id
     FROM doctor_schedule_slots
     WHERE doctor_id = ?
       AND ${active.where}
     LIMIT 1`,
    [doctorId, ...active.params]
  );
  return rows.length > 0;
}

export async function hasActiveScheduleForSpecialty(specialtyId: number) {
  const active = activeScheduleSql();
  const [rows] = await db.query<ExistsRow[]>(
    `SELECT dss.id
     FROM doctor_schedule_slots dss
     LEFT JOIN services s ON s.id = dss.service_id
     LEFT JOIN doctor_services ds
       ON ds.doctor_id = dss.doctor_id
      AND ds.service_id = dss.service_id
     WHERE (s.specialty_id = ? OR ds.specialty_id = ?)
       AND ${active.where}
     LIMIT 1`,
    [specialtyId, specialtyId, ...active.params]
  );
  return rows.length > 0;
}
