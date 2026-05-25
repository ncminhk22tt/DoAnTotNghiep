"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import styles from "./overview.module.css";

type OverviewResponse = {
  data: {
    users: {
      total: number;
      doctors: number;
      patients: number;
    };
    appointments: Array<{ label: string; total: number }>;
    revenue_completed: number;
    today_appointments: {
      pending: number;
      confirmed: number;
      completed: number;
      no_show: number;
      cancelled: number;
    };
  };
};

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.cardValue}>{value}</div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<OverviewResponse["data"] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const token = getAccessToken("admin");
        const res = await apiClient.get<OverviewResponse>("/api/admin/reports/overview", token);
        setData(res.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không tải được dashboard");
      }
    }
    load();
  }, []);

  const statusLabelMap = useMemo(
    () =>
      ({
        pending: "Chờ xác nhận",
        confirmed: "Đã xác nhận",
        completed: "Đã hoàn tất",
        no_show: "Vắng mặt",
        cancelled: "Đã hủy",
      }) satisfies Record<string, string>,
    []
  );

  if (error) return <p className={styles.errorText}>{error}</p>;
  if (!data) return <p>Đang tải dashboard...</p>;

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Tổng quan quản trị</h2>

      <div className={styles.cardGrid}>
        <Card label="Tổng người dùng" value={data.users.total} />
        <Card label="Bác sĩ" value={data.users.doctors} />
        <Card label="Bệnh nhân" value={data.users.patients} />
        <Card label="Doanh thu completed" value={data.revenue_completed} />
      </div>

      <div className={styles.panel}>
        <h3 className={styles.subTitle}>Thống kê lịch hẹn (tổng)</h3>
        <ul className={styles.list}>
          {data.appointments.map((a) => (
            <li key={a.label}>
              {statusLabelMap[a.label as keyof typeof statusLabelMap] || a.label}: {a.total}
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.panel}>
        <h3 className={styles.subTitle}>Vận hành hôm nay</h3>
        <div className={styles.todayGrid}>
          <Card label="Chờ xác nhận" value={data.today_appointments.pending} />
          <Card label="Đã xác nhận" value={data.today_appointments.confirmed} />
          <Card label="Đã hoàn tất" value={data.today_appointments.completed} />
          <Card label="Vắng mặt" value={data.today_appointments.no_show} />
          <Card label="Đã hủy" value={data.today_appointments.cancelled} />
        </div>
      </div>
    </div>
  );
}
