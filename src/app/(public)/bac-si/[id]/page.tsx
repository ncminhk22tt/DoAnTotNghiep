"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import styles from "./page.module.css";

type DoctorService = {
  service_id: number;
  service_name: string;
};

type DoctorDetail = {
  doctor_id: number;
  doctor_code: string | null;
  full_name: string;
  specialty_name: string | null;
  experience: number | null;
  description: string | null;
  services: DoctorService[];
};

type Slot = {
  id: number;
  start_time: string;
  end_time: string;
  room: string | null;
  status: "available" | "full" | "closed";
};

type DaySchedule = {
  date: string;
  dayLabel: string;
  slots: Slot[];
};

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}-${month}-${year}`;
}

function dayLabel(date: Date): string {
  const weekday = new Intl.DateTimeFormat("vi-VN", { weekday: "long" }).format(date);
  return `${weekday}, ${formatDisplayDate(toYMD(date))}`;
}

function next7Days(): Array<{ date: string; dayLabel: string }> {
  const base = new Date();
  const items: Array<{ date: string; dayLabel: string }> = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    items.push({ date: toYMD(d), dayLabel: dayLabel(d) });
  }
  return items;
}

export default function DoctorPublicDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [doctor, setDoctor] = useState<DoctorDetail | null>(null);
  const [weekSchedules, setWeekSchedules] = useState<DaySchedule[]>([]);

  const doctorId = useMemo(() => Number(params?.id), [params?.id]);
  const serviceId = useMemo(() => {
    const raw = Number(search.get("service_id"));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }, [search]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        if (!Number.isFinite(doctorId) || doctorId <= 0) {
          throw new Error("doctor_id khong hop le");
        }

        const detailRes = await apiClient.get<{ data: DoctorDetail }>(`/api/public/doctors/${doctorId}`);
        if (cancelled) return;
        setDoctor(detailRes.data || null);

        const days = next7Days();
        const scheduleResults = await Promise.all(
          days.map(async (day) => {
            const params = new URLSearchParams();
            params.set("date", day.date);
            if (serviceId) params.set("service_id", String(serviceId));
            const res = await apiClient.get<{ data: Slot[] }>(
              `/api/public/doctors/${doctorId}/schedule?${params.toString()}`
            );
            return {
              date: day.date,
              dayLabel: day.dayLabel,
              slots: res.data || [],
            };
          })
        );

        if (!cancelled) {
          setWeekSchedules(scheduleResults);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Khong the tai thong tin bac si");
          setWeekSchedules([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [doctorId, serviceId]);

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.title}>Thong tin bac si</h1>
        {loading ? <p className={styles.sub}>Dang tai...</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        {!loading && !error && doctor ? (
          <>
            <p className={styles.sub}>
              <strong>{doctor.full_name}</strong>
              {doctor.doctor_code ? ` - ${doctor.doctor_code}` : ""}
            </p>
            <p className={styles.sub}>
              Khoa: {doctor.specialty_name || "-"} | Kinh nghiem:{" "}
              {doctor.experience ? `${doctor.experience} nam` : "-"}
            </p>
            <p className={styles.sub}>{doctor.description || "Chua co mo ta."}</p>
            <p className={styles.services}>
              Dich vu:{" "}
              {doctor.services.length
                ? doctor.services.map((service) => service.service_name).join(", ")
                : "Chua co dich vu."}
            </p>
          </>
        ) : null}
      </section>

      <section className={styles.card}>
        <h2 className={styles.weekTitle}>Lich kham 7 ngay toi</h2>
        {weekSchedules.map((day) => (
          <article className={styles.dayCard} key={day.date}>
            <p className={styles.dayName}>
              {day.dayLabel}
            </p>
            {day.slots.length === 0 ? (
              <p className={styles.empty}>Khong co lich.</p>
            ) : (
              <div className={styles.slots}>
                {day.slots.map((slot) => {
                  const statusClass =
                    slot.status === "full"
                      ? styles.slotFull
                      : slot.status === "closed"
                      ? styles.slotClosed
                      : "";
                  return (
                    <span key={slot.id} className={`${styles.slot} ${statusClass}`}>
                      {slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)} | {slot.status}
                    </span>
                  );
                })}
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
