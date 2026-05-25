"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
      showToast(err instanceof Error ? err.message : "Khong the tai chuyen khoa", "error");
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
          <div className={styles.breadcrumbWrapper}>
            <Breadcrumbs
              items={[
                { label: "Trang chu", href: "/", home: true },
                { label: "Kham chuyen khoa" },
              ]}
            />
          </div>
          <h1 className={styles.title}>Danh sach chuyen khoa danh cho ban</h1>
          <p className={styles.sub}>Chon chuyen khoa phu hop, xem bac si lien quan va dat lich nhanh.</p>
          <div className={styles.filters}>
            <div className={styles.inputWrapper}>
              <svg className={styles.searchIcon} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16ZM19 19l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <input
                className={styles.control}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Tim chuyen khoa..."
              />
            </div>
            <div className={styles.selectWrapper}>
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
              <svg className={styles.selectIcon} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          {loading ? (
            <div className={styles.loadingWrapper}>
              <div className={styles.spinner}></div>
              <p className={styles.empty}>Dang tai danh sach chuyen khoa...</p>
            </div>
          ) : filteredSpecialties.length === 0 ? (
            <div className={styles.emptyWrapper}>
              <svg className={styles.emptyIcon} width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="2" opacity="0.2"/>
                <path d="M32 20v16M32 44h.02" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
              </svg>
              <p className={styles.empty}>Khong co chuyen khoa phu hop bo loc.</p>
            </div>
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
                      <img src={s.logo_url} alt={s.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      acronym(s.name)
                    )}
                  </div>
                  <div className={styles.cardBody}>
                    <p className={styles.name}>{s.name}</p>
                    <p className={styles.meta}>{s.description || "Chuyen khoa kham va dieu tri chuyen sau."}</p>
                    <span className={styles.cardCta}>
                      Xem danh sach dich vu
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
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