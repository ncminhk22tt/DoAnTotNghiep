"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { useToast } from "@/components/ui/ToastProvider";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import styles from "./page.module.css";

const DOCTOR_AVATAR_PLACEHOLDER = "/doctor-avatar-placeholder.svg";

function resolveAvatarSrc(avatar: string | null) {
  if (!avatar) return DOCTOR_AVATAR_PLACEHOLDER;
  const src = avatar.trim();
  if (!src) return DOCTOR_AVATAR_PLACEHOLDER;
  const isValid =
    src.startsWith("/") ||
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:image/");
  return isValid ? src : DOCTOR_AVATAR_PLACEHOLDER;
}

type Doctor = {
  doctor_id: number;
  doctor_code: string | null;
  full_name: string;
  avatar: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
  experience: number | null;
  description: string | null;
  rating_avg?: number | null;
  rating_count?: number;
};

type Specialty = {
  id: number;
  name: string;
};

type Service = {
  id: number;
  name: string;
  specialty_id: number | null;
};

function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function toPositiveInt(raw: string | null) {
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export default function DoctorListingPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  const [keyword, setKeyword] = useState("");
  const [specialtyId, setSpecialtyId] = useState(0);
  const [serviceId, setServiceId] = useState(0);

  async function loadMetaData() {
    try {
      const [specialtyRes, serviceRes] = await Promise.all([
        apiClient.get<{ data: Specialty[] }>("/api/public/specialties"),
        apiClient.get<{ data: Service[] }>("/api/public/services"),
      ]);
      setSpecialties(specialtyRes.data || []);
      setServices(serviceRes.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the tai bo loc", "error");
    }
  }

  async function loadDoctors() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (specialtyId > 0) params.set("specialty_id", String(specialtyId));
      if (serviceId > 0) params.set("service_id", String(serviceId));
      const qs = params.toString();
      const doctorRes = await apiClient.get<{ data: Doctor[] }>(
        `/api/public/doctors${qs ? `?${qs}` : ""}`
      );
      setDoctors(doctorRes.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the tai danh sach bac si", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMetaData();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    setSpecialtyId(toPositiveInt(query.get("specialty_id")));
    setServiceId(toPositiveInt(query.get("service_id")));
    setKeyword(query.get("q") || "");
  }, []);

  useEffect(() => {
    loadDoctors();
  }, [specialtyId, serviceId]);

  const filteredServices = useMemo(() => {
    if (specialtyId === 0) return services;
    return services.filter((s) => s.specialty_id === specialtyId);
  }, [services, specialtyId]);

  useEffect(() => {
    if (serviceId === 0) return;
    const exists = filteredServices.some((s) => s.id === serviceId);
    if (!exists) setServiceId(0);
  }, [filteredServices, serviceId]);

  const filteredDoctors = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return doctors.filter((d) => {
      if (!kw) return true;
      return (
        d.full_name.toLowerCase().includes(kw) ||
        (d.specialty_name || "").toLowerCase().includes(kw) ||
        (d.doctor_code || "").toLowerCase().includes(kw) ||
        (d.description || "").toLowerCase().includes(kw)
      );
    });
  }, [doctors, keyword, specialtyId]);

  function goToBookingByDoctor(doctor: Doctor) {
    if (!doctor.specialty_id || !doctor.specialty_name) {
      showToast("Bac si chua duoc gan chuyen khoa de dat lich.", "error");
      return;
    }

    const specialtySlug = slugify(doctor.specialty_name);
    const query = new URLSearchParams();
    query.set("doctor_id", String(doctor.doctor_id));
    if (serviceId > 0) {
      query.set("service_id", String(serviceId));
    }
    router.push(
      `/chuyen-khoa/${specialtySlug}-s${doctor.specialty_id}?${query.toString()}`
    );
  }

  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <section className={styles.hero}>
          <Breadcrumbs
            items={[
              { label: "Trang chu", href: "/", home: true },
              { label: "Bac si" },
            ]}
          />
          <h1 className={styles.title}>Danh sach bac si danh cho ban</h1>
          <p className={styles.sub}>Chon bac si phu hop va chuyen den trang dat lich.</p>
          <div className={styles.filters}>
            <input
              className={styles.control}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Tim ten bac si, ma bac si..."
            />
            <select
              className={styles.control}
              value={specialtyId}
              onChange={(e) => setSpecialtyId(Number(e.target.value))}
            >
              <option value={0}>Tat ca chuyen khoa</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              className={styles.control}
              value={serviceId}
              onChange={(e) => setServiceId(Number(e.target.value))}
            >
              <option value={0}>Tat ca dich vu</option>
              {filteredServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.section}>
          {loading ? (
            <p className={styles.empty}>Dang tai danh sach bac si...</p>
          ) : filteredDoctors.length === 0 ? (
            <p className={styles.empty}>Khong co bac si phu hop bo loc.</p>
          ) : (
            <div className={styles.grid}>
              {filteredDoctors.map((d) => (
                <button key={d.doctor_id} className={styles.card} onClick={() => goToBookingByDoctor(d)}>
                  <img
                    className={styles.avatar}
                    src={resolveAvatarSrc(d.avatar)}
                    alt={d.full_name}
                    onError={(e) => {
                      e.currentTarget.src = DOCTOR_AVATAR_PLACEHOLDER;
                    }}
                  />
                  <div className={styles.cardBody}>
                    <h3 className={styles.cardTitle}>{d.full_name}</h3>
                    <p className={styles.cardMeta}>
                      {d.specialty_name || "Chua co chuyen khoa"} {d.doctor_code ? `| ${d.doctor_code}` : ""}
                    </p>
                    <p className={styles.cardDesc}>
                      {typeof d.experience === "number"
                        ? `${d.experience} nam kinh nghiem`
                        : "Bac si chuyen khoa"}
                    </p>
                    <p className={styles.cardMeta}>
                      Danh gia: {Number(d.rating_avg || 0).toFixed(1)} ({d.rating_count || 0})
                    </p>
                    <span className={styles.cardCta}>Dat lich voi bac si nay</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
