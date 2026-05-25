"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./overview.module.css";

type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled";

type AppointmentRow = {
  id: number;
  status: AppointmentStatus;
  patient_name: string | null;
  work_date: string | null;
  start_time: string | null;
};

type MedicalRecordRow = {
  id: number;
};

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.cardValue}>{value}</div>
    </div>
  );
}

export default function DoctorDashboardPage() {
  const { showToast } = useToast();
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [records, setRecords] = useState<MedicalRecordRow[]>([]);

  async function loadData() {
    try {
      const token = getAccessToken();
      const [appointmentsRes, recordsRes] = await Promise.all([
        apiClient.get<{ data: AppointmentRow[] }>("/api/doctor/appointments", token),
        apiClient.get<{ data: MedicalRecordRow[] }>("/api/doctor/medical-records", token),
      ]);
      setAppointments(appointmentsRes.data || []);
      setRecords(recordsRes.data || []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể tải dữ liệu tổng quan", "error");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const counts = useMemo(
    () => ({
      total: appointments.length,
      pending: appointments.filter((x) => x.status === "pending").length,
      confirmed: appointments.filter((x) => x.status === "confirmed").length,
      completed: appointments.filter((x) => x.status === "completed").length,
      records: records.length,
    }),
    [appointments, records]
  );

  const today = new Date().toISOString().slice(0, 10);
  const todayAppointments = appointments.filter((x) => x.work_date === today).slice(0, 8);

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Tổng quan bác sĩ</h2>

      <div className={styles.grid}>
        <Card label="Tổng lịch hẹn" value={counts.total} />
        <Card label="Chờ xác nhận" value={counts.pending} />
        <Card label="Đã xác nhận" value={counts.confirmed} />
        <Card label="Đã hoàn tất" value={counts.completed} />
        <Card label="Hồ sơ bệnh án" value={counts.records} />
      </div>

      <section className={styles.listCard}>
        <h3 className={styles.subTitle}>Lịch hẹn trong ngày ({today})</h3>
        {todayAppointments.length === 0 ? (
          <div className={styles.empty}>Hôm nay chưa có lịch hẹn.</div>
        ) : (
          <div className={styles.list}>
            {todayAppointments.map((item) => (
              <div key={item.id} className={styles.item}>
                <div>
                  <strong>{item.patient_name || "Bệnh nhân"}</strong>
                </div>
                <div>
                  {item.start_time ? item.start_time.slice(0, 5) : "--:--"} - trạng thái: {item.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

