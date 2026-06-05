"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { resolveSafeImageSrc } from "@/lib/imageSrc";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import styles from "./page.module.css";

type Specialty = {
  id: number;
  name: string;
  description: string | null;
  logo_url: string | null;
};

type Service = {
  id: number;
  name: string;
  specialty_id: number | null;
  specialty_name: string | null;
  description: string | null;
  logo_url: string | null;
};

type ServiceGroup = {
  specialtyId: number;
  specialtyName: string;
  specialtyDescription: string | null;
  specialtyLogoUrl: string | null;
  services: Service[];
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

export default function ServiceListingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selectedSpecialtyId, setSelectedSpecialtyId] = useState(0);
  const [selectedServiceId, setSelectedServiceId] = useState(0);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("q") || "";
    setKeyword(q);
  }, []);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [specialtyRes, serviceRes] = await Promise.all([
          apiClient.get<{ data: Specialty[] }>("/api/public/specialties"),
          apiClient.get<{ data: Service[] }>("/api/public/services"),
        ]);
        setSpecialties(specialtyRes.data || []);
        setServices(serviceRes.data || []);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const serviceGroups = useMemo(() => {
    const kw = keyword.trim().toLowerCase();

    const filtered = services.filter((service) => {
      if (selectedSpecialtyId > 0 && service.specialty_id !== selectedSpecialtyId) return false;
      if (selectedServiceId > 0 && service.id !== selectedServiceId) return false;
      if (kw) {
        const matched =
          service.name.toLowerCase().includes(kw) ||
          (service.description || "").toLowerCase().includes(kw) ||
          (service.specialty_name || "").toLowerCase().includes(kw);
        if (!matched) return false;
      }
      return true;
    });

    const specialtyOrder = new Map<number, number>();
    specialties.forEach((s, index) => specialtyOrder.set(s.id, index));

    const grouped = new Map<number, ServiceGroup>();
    for (const service of filtered) {
      if (!service.specialty_id) continue;
      if (!grouped.has(service.specialty_id)) {
        const specialty = specialties.find((s) => s.id === service.specialty_id) || null;
        grouped.set(service.specialty_id, {
          specialtyId: service.specialty_id,
          specialtyName: service.specialty_name || specialty?.name || "Chua co khoa",
          specialtyDescription: specialty?.description || null,
          specialtyLogoUrl: specialty?.logo_url || null,
          services: [],
        });
      }
      grouped.get(service.specialty_id)?.services.push(service);
    }

    const sortedGroups = [...grouped.values()]
      .map((group) => ({
        ...group,
        services: [...group.services].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => {
        const ai = specialtyOrder.get(a.specialtyId) ?? Number.MAX_SAFE_INTEGER;
        const bi = specialtyOrder.get(b.specialtyId) ?? Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return a.specialtyName.localeCompare(b.specialtyName);
      });

    return sortedGroups;
  }, [services, specialties, selectedSpecialtyId, selectedServiceId, keyword]);

  const visibleServicesInFilter = useMemo(() => {
    if (selectedSpecialtyId === 0) return services;
    return services.filter((s) => s.specialty_id === selectedSpecialtyId);
  }, [services, selectedSpecialtyId]);

  useEffect(() => {
    if (selectedServiceId === 0) return;
    const exists = visibleServicesInFilter.some((s) => s.id === selectedServiceId);
    if (!exists) setSelectedServiceId(0);
  }, [selectedServiceId, visibleServicesInFilter]);

  const totalVisibleServices = useMemo(
    () => serviceGroups.reduce((sum, group) => sum + group.services.length, 0),
    [serviceGroups]
  );

  function goService(service: Service) {
    if (!service.specialty_id || !service.specialty_name) return;
    const specialtySlug = slugify(service.specialty_name);
    router.push(`/chuyen-khoa/${specialtySlug}-s${service.specialty_id}?service_id=${service.id}`);
  }

  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <section className={styles.hero}>
          <div className={styles.breadcrumbWrapper}>
            <Breadcrumbs
              items={[
                { label: "Trang chu", href: "/", home: true },
                { label: "Dịch vụ" },
              ]}
            />
          </div>
          <h1 className={styles.title}>Danh sách dịch vụ khám</h1>
          <p className={styles.sub}>
            Lọc theo khoa và dịch vụ. Các dịch vụ cùng khoa được nhóm trong cùng một khung.
          </p>

          <div className={styles.filters}>
            <div className={styles.inputWrapper}>
              <svg className={styles.searchIcon} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16ZM19 19l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <input
                className={styles.control}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Tìm tên dịch vụ, chuyên khoa..."
              />
            </div>
            <div className={styles.selectWrapper}>
              <select
                className={styles.control}
                value={selectedSpecialtyId}
                onChange={(e) => setSelectedSpecialtyId(Number(e.target.value))}
              >
                <option value={0}>Tất cả chuyên khoa</option>
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
            <div className={styles.selectWrapper}>
              <select
                className={styles.control}
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(Number(e.target.value))}
              >
                <option value={0}>Tất cả dịch vụ</option>
                {visibleServicesInFilter.map((s) => (
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
              <p className={styles.empty}>Đang tải danh sách dịch vụ...</p>
            </div>
          ) : null}
          {!loading && serviceGroups.length === 0 ? (
            <div className={styles.emptyWrapper}>
              <svg className={styles.emptyIcon} width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="2" opacity="0.2"/>
                <path d="M32 20v16M32 44h.02" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
              </svg>
              <p className={styles.empty}>Không có dịch vụ phù hợp với bộ lọc hiện tại.</p>
            </div>
          ) : null}

          {!loading && serviceGroups.length > 0 ? (
            <>
              <p className={styles.summary}>
                Có {totalVisibleServices} dịch vụ trong {serviceGroups.length} khoa.
              </p>

              <div className={styles.groupList}>
                {serviceGroups.map((group) => (
                  <article key={group.specialtyId} className={styles.groupCard}>
                    <div className={styles.groupCardHeader}>
                      {group.specialtyLogoUrl && (
                        <div className={styles.groupLogoContainer}>
                          <img
                            src={resolveSafeImageSrc(group.specialtyLogoUrl, "/file.svg")}
                            alt={group.specialtyName}
                            className={styles.groupLogo}
                          />
                        </div>
                      )}
                      <div className={styles.groupHead}>
                        <h2 className={styles.groupTitle}>{group.specialtyName}</h2>
                        <p className={styles.groupDesc}>
                          {group.specialtyDescription || "Danh sach dich vu thuoc khoa nay."}
                        </p>
                      </div>
                      <span className={styles.groupCount}>{group.services.length} dịch vụ</span>
                    </div>

                    <div className={styles.serviceGrid}>
                      {group.services.map((service) => (
                        <button
                          key={service.id}
                          className={styles.serviceCard}
                          onClick={() => goService(service)}
                        >
                          {service.logo_url && (
                            <div className={styles.serviceLogoContainer}>
                              <img
                                src={resolveSafeImageSrc(service.logo_url, "/file.svg")}
                                alt={service.name}
                                className={styles.serviceLogo}
                              />
                            </div>
                          )}
                          <div className={styles.serviceContent}>
                            <p className={styles.serviceName}>{service.name}</p>
                            <p className={styles.serviceDesc}>
                              {service.description || "Dịch vụ khám theo chuyên khoa."}
                            </p>
                            <span className={styles.serviceCta}>Xem lịch khám</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}