"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import styles from "./page.module.css";

type Specialty = {
  id: number;
  name: string;
  description: string | null;
};

type Service = {
  id: number;
  name: string;
  specialty_id: number | null;
  specialty_name: string | null;
  description: string | null;
};

function parseSpecialtyIdFromSlug(slug: string): number | null {
  const match = slug.match(/-s(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function acronym(name: string) {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "DV";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

export default function SpecialtyServicesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [invalidSlug, setInvalidSlug] = useState(false);
  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [keyword, setKeyword] = useState("");
  const [serviceId, setServiceId] = useState(0);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const { slug } = await params;
        const specialtyId = parseSpecialtyIdFromSlug(slug);
        if (!specialtyId) {
          setInvalidSlug(true);
          return;
        }

        const [specialtyRes, serviceRes] = await Promise.all([
          apiClient.get<{ data: Specialty[] }>("/api/public/specialties"),
          apiClient.get<{ data: Service[] }>(`/api/public/services?specialty_id=${specialtyId}`),
        ]);

        const current = (specialtyRes.data || []).find((s) => s.id === specialtyId) || null;
        if (!current) {
          setInvalidSlug(true);
          return;
        }

        setSpecialty(current);
        setServices(serviceRes.data || []);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [params]);

  const filteredServices = useMemo(() => {
    const bySelected = serviceId > 0 ? services.filter((s) => s.id === serviceId) : services;
    const kw = keyword.trim().toLowerCase();
    if (!kw) return bySelected;
    return bySelected.filter((s) => {
      return s.name.toLowerCase().includes(kw) || (s.description || "").toLowerCase().includes(kw);
    });
  }, [services, keyword, serviceId]);

  if (loading) {
    return (
      <div className={styles.page}>
        <main className={styles.container}>
          <section className={styles.hero}>Dang tai danh sach dich vu...</section>
        </main>
      </div>
    );
  }

  if (invalidSlug || !specialty) {
    return (
      <div className={styles.page}>
        <main className={styles.container}>
          <section className={styles.hero}>Khong tim thay chuyen khoa.</section>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <section className={styles.hero}>
          <Breadcrumbs
            items={[
              { label: "Trang chu", href: "/", home: true },
              { label: "Kham chuyen khoa", href: "/chuyen-khoa" },
              { label: specialty.name },
            ]}
          />
          <h1 className={styles.title}>Danh sach dich vu - {specialty.name}</h1>
          <p className={styles.sub}>{specialty.description || "Chon dich vu de xem bac si phu hop."}</p>
          <div className={styles.filters}>
            <input
              className={styles.control}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Tim dich vu..."
            />
            <select
              className={styles.control}
              value={serviceId}
              onChange={(e) => setServiceId(Number(e.target.value))}
            >
              <option value={0}>Tat ca dich vu</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.section}>
          {filteredServices.length === 0 ? (
            <p className={styles.empty}>Khong co dich vu phu hop bo loc.</p>
          ) : (
            <div className={styles.grid}>
              {filteredServices.map((service) => (
                <button
                  key={service.id}
                  className={styles.card}
                  onClick={() =>
                    router.push(
                      `/chuyen-khoa/${slugify(specialty.name)}-s${specialty.id}?service_id=${service.id}`
                    )
                  }
                >
                  <div className={styles.icon}>{acronym(service.name)}</div>
                  <div className={styles.cardBody}>
                    <p className={styles.name}>{service.name}</p>
                    <p className={styles.meta}>{service.description || "Dich vu kham theo chuyen khoa."}</p>
                    <span className={styles.cardCta}>Xem bac si thuoc dich vu nay</span>
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

