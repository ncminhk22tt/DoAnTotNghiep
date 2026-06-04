"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { resolveSafeImageSrc } from "@/lib/imageSrc";
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

type Doctor = {
  doctor_id: number;
  full_name: string;
  specialty_name: string | null;
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

export default function HomePage() {
  const router = useRouter();
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [specialtyPage, setSpecialtyPage] = useState(0);
  const visibleSpecialties = specialties.slice(0, 8);
  const visibleServices = services.slice(0, 6);

  const goSearchPage = () => {
    router.push(`/tim-kiem${searchTerm.trim() ? `?q=${encodeURIComponent(searchTerm.trim())}` : ""}`);
  };

  useEffect(() => {
    const loadHomeData = async () => {
      try {
        const [specialtyRes, serviceRes, doctorRes] = await Promise.all([
          apiClient.get<{ data: Specialty[] }>("/api/public/specialties"),
          apiClient.get<{ data: Service[] }>("/api/public/services"),
          apiClient.get<{ data: Doctor[] }>("/api/public/doctors"),
        ]);
        setSpecialties(specialtyRes.data || []);
        setServices(serviceRes.data || []);
        setDoctors(doctorRes.data || []);
      } catch {
        setSpecialties([]);
        setServices([]);
        setDoctors([]);
      }
    };
    loadHomeData();
  }, []);

  // Search suggestions
  const searchSuggestions = useMemo(() => {
    if (!searchTerm.trim()) return [];

    const term = searchTerm.toLowerCase();
    const results: Array<{
      type: string;
      name: string;
      meta?: string;
      specialtyId?: number;
      serviceId?: number;
      specialtyName?: string | null;
    }> = [];

    // Search doctors
    doctors.forEach((doc) => {
      if (doc.full_name.toLowerCase().includes(term)) {
        results.push({
          type: "Bác sĩ",
          name: doc.full_name,
          meta: doc.specialty_name || "Bác sĩ chuyên khoa",
        });
      }
    });

    // Search specialties
    specialties.forEach(spec => {
      if (spec.name.toLowerCase().includes(term)) {
        results.push({
          type: "Chuyên khoa",
          name: spec.name,
          meta: spec.description || "Chuyên khoa khám và điều trị chuyên sâu",
          specialtyId: spec.id,
        });
      }
    });

    // Search services
    services.forEach(srv => {
      if (srv.name.toLowerCase().includes(term)) {
        results.push({
          type: "Dịch vụ",
          name: srv.name,
          meta: srv.specialty_name || srv.description || "Dịch vụ khám theo chuyên khoa",
          serviceId: srv.id,
          specialtyId: srv.specialty_id || undefined,
          specialtyName: srv.specialty_name,
        });
      }
    });

    return results.slice(0, 6);
  }, [searchTerm, specialties, services, doctors]);

  // Mobile carousel for specialties (2 per page)
  const itemsPerPage = 2;
  const maxPage = Math.max(0, Math.ceil(visibleSpecialties.length / itemsPerPage) - 1);
  const canPrev = specialtyPage > 0;
  const canNext = specialtyPage < maxPage;

  const goSuggestion = (item: {
    type: string;
    name: string;
    specialtyId?: number;
    serviceId?: number;
    specialtyName?: string | null;
  }) => {
    if (item.type === "Chuyên khoa" && item.specialtyId) {
      const slug = slugify(item.name);
      router.push(`/dich-vu/${slug}-s${item.specialtyId}`);
      return;
    }
    if (item.type === "Dịch vụ" && item.serviceId && item.specialtyId && item.specialtyName) {
      const slug = slugify(item.specialtyName);
      router.push(`/chuyen-khoa/${slug}-s${item.specialtyId}?service_id=${item.serviceId}`);
      return;
    }
    if (item.type === "Bác sĩ") {
      router.push(`/bac-si?q=${encodeURIComponent(item.name)}`);
      return;
    }
    router.push(`/tim-kiem?q=${encodeURIComponent(item.name)}`);
  };

  return (
    <div className={styles.page}>
      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.container}>
          <div className={styles.heroGrid}>
            {/* Left Content */}
            <div className={styles.heroContent}>
              <h1 className={styles.heroTitle}>
                Chăm sóc sức khỏe <span className={styles.highlight}>thông minh</span> cho cả gia đình
              </h1>
              <p className={styles.heroSubtitle}>
                Kết nối với bác sĩ chuyên khoa, tìm dịch vụ phù hợp và đặt lịch nhanh chỉ trong vài bước.
              </p>

              {/* Search Bar */}
              <div className={styles.searchWrapper}>
                <div className={styles.searchBar}>
                  <svg className={styles.searchIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Tìm bác sĩ, triệu chứng, chuyên khoa..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        goSearchPage();
                      }
                    }}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                    className={styles.searchInput}
                  />

                  {/* Search Suggestions */}
                  {searchFocused && searchSuggestions.length > 0 && (
                    <div className={styles.suggestions}>
                      {searchSuggestions.map((item, idx) => (
                        <button
                          key={idx}
                          className={styles.suggestionItem}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => goSuggestion(item)}
                        >
                          <span className={styles.suggestionType}>{item.type}</span>
                          <div className={styles.suggestionContent}>
                            <p className={styles.suggestionName}>{item.name}</p>
                            {item.meta && <p className={styles.suggestionMeta}>{item.meta}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  className={styles.searchButton}
                  onClick={goSearchPage}
                >
                  Tìm kiếm
                </button>
              </div>

              {/* Quick Actions */}
              <div className={styles.quickActions}>
                <button className={styles.quickCard} onClick={() => router.push("/chuyen-khoa")}>
                  <span className={styles.quickIcon}>📅</span>
                  <div>
                    <p className={styles.quickTitle}>Tìm chuyên khoa</p>
                    <p className={styles.quickSubtitle}>Phù hợp nhu cầu</p>
                  </div>
                </button>

                <button className={styles.quickCard} onClick={() => router.push("/bac-si")}>
                  <span className={styles.quickIcon}>🩺</span>
                  <div>
                    <p className={styles.quickTitle}>Tìm bác sĩ</p>
                    <p className={styles.quickSubtitle}>Chuyên khoa</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Right Image */}
            <div className={styles.heroImage}>
              <img
                src="https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=600&h=700&fit=crop"
                alt="Doctor"
              />
              <div className={styles.badge}>
                <span className={styles.badgeIcon}>✓</span>
                {/* <span className={styles.badgeText}>100% Verified</span> */}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Specialties Section */}
      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Các chuyên khoa</h2>
            <p className={styles.sectionSubtitle}>Danh sách chuyên khoa nổi bật tại phòng khám</p>
          </div>

          {/* Desktop Grid */}
          <div className={styles.specialtyGrid}>
            {visibleSpecialties.map((specialty) => (
              <button
                key={specialty.id}
                className={styles.specialtyCard}
                onClick={() => router.push(`/dich-vu/${slugify(specialty.name)}-s${specialty.id}`)}
              >
                <span className={styles.specialtyIcon}>
                  {specialty.logo_url ? <img src={resolveSafeImageSrc(specialty.logo_url, "/file.svg")} alt={specialty.name} /> : "CK"}
                </span>
                <h3 className={styles.specialtyName}>{specialty.name}</h3>
                <p className={styles.specialtyDesc}>
                  {specialty.description || "Chuyên khoa khám và điều trị chuyên sâu."}
                </p>
              </button>
            ))}
          </div>

          {/* Mobile Carousel */}
          <div className={styles.mobileCarousel}>
            <button
              onClick={() => setSpecialtyPage(p => Math.max(0, p - 1))}
              disabled={!canPrev}
              className={styles.carouselButton}
            >
              ‹
            </button>

            <div className={styles.carouselTrack}>
              <div
                className={styles.carouselInner}
                style={{ transform: `translateX(-${specialtyPage * 100}%)` }}
              >
                {Array.from({ length: Math.ceil(visibleSpecialties.length / itemsPerPage) }).map((_, pageIdx) => (
                  <div key={pageIdx} className={styles.carouselPage}>
                    {visibleSpecialties.slice(pageIdx * itemsPerPage, (pageIdx + 1) * itemsPerPage).map((specialty) => (
                      <button
                        key={specialty.id}
                        className={styles.specialtyCard}
                        onClick={() => router.push(`/dich-vu/${slugify(specialty.name)}-s${specialty.id}`)}
                      >
                        <span className={styles.specialtyIcon}>
                          {specialty.logo_url ? <img src={resolveSafeImageSrc(specialty.logo_url, "/file.svg")} alt={specialty.name} /> : "CK"}
                        </span>
                        <h3 className={styles.specialtyName}>{specialty.name}</h3>
                        <p className={styles.specialtyDesc}>
                          {specialty.description || "Chuyên khoa khám và điều trị chuyên sâu."}
                        </p>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => setSpecialtyPage(p => Math.min(maxPage, p + 1))}
              disabled={!canNext}
              className={styles.carouselButton}
            >
              ›
            </button>
          </div>

          {/* Pagination Dots */}
          <div className={styles.pagination}>
            {Array.from({ length: maxPage + 1 }).map((_, idx) => (
              <button
                key={idx}
                onClick={() => setSpecialtyPage(idx)}
                className={`${styles.dot} ${idx === specialtyPage ? styles.dotActive : ''}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section className={styles.servicesSection}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Dịch vụ khám</h2>
            <p className={styles.sectionSubtitle}>Đa dạng dịch vụ y tế chất lượng cao</p>
          </div>

          <div className={styles.serviceGrid}>
            {visibleServices.map((service) => (
              <article key={service.id} className={styles.serviceCard}>
                <div className={styles.serviceImageWrapper}>
                  <img
                    src={resolveSafeImageSrc(service.logo_url, "https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=400&h=300&fit=crop")}
                    alt={service.name}
                    className={styles.serviceImage}
                  />
                </div>

                <div className={styles.serviceContent}>
                  <h3 className={styles.serviceName}>{service.name}</h3>
                  <p className={styles.serviceDescription}>{service.description}</p>

                  <div className={styles.serviceInfo}>
                    <div className={styles.infoItem}>
                      <span className={styles.infoIcon}>🩺</span>
                      <span>{service.specialty_name || "Chuyên khoa"}</span>
                    </div>
                    <div className={styles.infoItem}>
                      <span className={styles.infoIcon}>📍</span>
                      <span>Tại phòng khám</span>
                    </div>
                  </div>

                  <button
                    className={styles.serviceButton}
                    onClick={() => {
                      if (!service.specialty_id || !service.specialty_name) {
                        router.push("/dich-vu");
                        return;
                      }
                      router.push(
                        `/chuyen-khoa/${slugify(service.specialty_name)}-s${service.specialty_id}?service_id=${service.id}`
                      );
                    }}
                  >
                    Đặt lịch ngay
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerGrid}>
            <div>
              <h4 className={styles.footerBrand}>SmartHealth Clinic</h4>
              <p className={styles.footerDescription}>
                Nền tảng đặt lịch khám trực tuyến cho phòng khám và bệnh nhân.
              </p>
            </div>

            <div>
              <h5 className={styles.footerHeading}>Sản phẩm</h5>
              <ul className={styles.footerLinks}>
                <li><a href="#">Tìm bác sĩ</a></li>
                <li><a href="#">Gói khám</a></li>
                <li><a href="#">Tư vấn online</a></li>
              </ul>
            </div>

            <div>
              <h5 className={styles.footerHeading}>Công ty</h5>
              <ul className={styles.footerLinks}>
                <li><a href="#">Về chúng tôi</a></li>
                <li><a href="#">Liên hệ</a></li>
                <li><a href="#">Tuyển dụng</a></li>
              </ul>
            </div>

            <div>
              <h5 className={styles.footerHeading}>Hỗ trợ</h5>
              <ul className={styles.footerLinks}>
                <li><a href="#">Điều khoản</a></li>
                <li><a href="#">Bảo mật</a></li>
                <li><a href="#">Câu hỏi thường gặp</a></li>
              </ul>
            </div>
          </div>

          <div className={styles.footerBottom}>
            <p>&copy; 2024 SmartHealth Clinic. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
