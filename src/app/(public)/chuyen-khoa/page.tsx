"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { useToast } from "@/components/ui/ToastProvider";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import styles from "./page.module.css";

type Specialty = {
  id: number;
  name: string;
  description: string | null;
  logo_url: string | null;
};

function acronym(name: string) {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "CK";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
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

export default function SpecialtyListingPage() {
  const { showToast } = useToast();
  const router = useRouter();
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [specialtyId, setSpecialtyId] = useState(0);

  async function loadSpecialties() {
    try {
      setLoading(true);
      const res = await apiClient.get<{ data: Specialty[] }>("/api/public/specialties");
      setSpecialties(res.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể tải chuyên khoa", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSpecialties();
  }, []);

  const filteredSpecialties = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const keywordFiltered = !kw
      ? specialties
      : specialties.filter((s) => {
          return s.name.toLowerCase().includes(kw) || (s.description || "").toLowerCase().includes(kw);
        });
    return specialtyId > 0 ? keywordFiltered.filter((s) => s.id === specialtyId) : keywordFiltered;
  }, [specialties, keyword, specialtyId]);

  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <section className={styles.hero}>
          <Breadcrumbs
            items={[
              { label: "Trang chủ", href: "/", home: true },
              { label: "Khám chuyên khoa" },
            ]}
          />
          <h1 className={styles.title}>Danh sách chuyên khoa dành cho bạn</h1>
          <p className={styles.sub}>Chọn chuyên khoa phù hợp, xem bác sĩ liên quan và đặt lịch nhanh.</p>
          <div className={styles.filters}>
            <input
              className={styles.control}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Tìm chuyên khoa..."
            />
            <select
              className={styles.control}
              value={specialtyId}
              onChange={(e) => setSpecialtyId(Number(e.target.value))}
            >
              <option value={0}>Tất cả chuyên khoa</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.section}>
          {loading ? (
            <p className={styles.empty}>Đang tải danh sách chuyên khoa...</p>
          ) : filteredSpecialties.length === 0 ? (
            <p className={styles.empty}>Không có chuyên khoa phù hợp bộ lọc.</p>
          ) : (
            <div className={styles.grid}>
              {filteredSpecialties.map((s) => (
                <button
                  key={s.id}
                  className={styles.card}
                  onClick={() => router.push(`/dich-vu/${slugify(s.name)}-s${s.id}`)}
                >
                  <div className={styles.icon}>
                    {s.logo_url ? (
                      <img
                        src={s.logo_url}
                        alt={s.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      acronym(s.name)
                    )}
                  </div>
                  <div className={styles.cardBody}>
                    <p className={styles.name}>{s.name}</p>
                    <p className={styles.meta}>{s.description || "Chuyên khoa khám và điều trị chuyên sâu."}</p>
                    <span className={styles.cardCta}>Xem danh sách dịch vụ</span>
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
