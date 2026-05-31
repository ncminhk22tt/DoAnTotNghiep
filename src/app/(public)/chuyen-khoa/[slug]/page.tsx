"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken, getAuthUser } from "@/lib/authClient";
import { Breadcrumbs } from "@/components/navigation/Breadcrumbs";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./page.module.css";

const DOCTOR_AVATAR_PLACEHOLDER = "/doctor-avatar-placeholder.svg";

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

type DoctorLite = {
  doctor_id: number;
  doctor_code: string | null;
  full_name: string;
  avatar?: string | null;
  specialty_name: string | null;
  experience: number | null;
  description: string | null;
  rating_avg?: number | null;
  rating_count?: number;
};

type DoctorDetail = {
  doctor_id: number;
  doctor_code: string | null;
  full_name: string;
  avatar: string | null;
  specialty_id?: number | null;
  specialty_name: string | null;
  experience: number | null;
  description: string | null;
  rating_avg?: number | null;
  rating_count?: number;
  services: Array<{ service_id: number; service_name: string }>;
};

type Slot = {
  id: number;
  service_id?: number;
  start_time: string;
  end_time: string;
  price: number;
  room: string | null;
  status: "available" | "full" | "closed";
};

type DoctorReview = {
  id: number;
  reviewer_name: string;
  comment: string | null;
  rating: number;
  created_at: string;
};

type BookingForm = {
  full_name: string;
  phone: string;
  gender: "male" | "female";
  birth_year: string;
  reason: string;
};

type UserProfile = {
  full_name: string | null;
  phone: string | null;
  gender: "male" | "female" | null;
  birth_year: number | string | null;
};

type PatientAppointmentLite = {
  note: string | null;
};

type TimeRangeOption = {
  key: string;
  label: string;
  start: string;
  end: string;
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

function todayYMD() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

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

function isSlotPastNow(workDate: string, startTime: string) {
  const datePart = workDate.includes("T") ? workDate.slice(0, 10) : workDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return true;
  const hhmmss = /^\d{2}:\d{2}:\d{2}$/.test(startTime)
    ? startTime
    : /^\d{2}:\d{2}$/.test(startTime)
    ? `${startTime}:00`
    : `${startTime.slice(0, 5)}:00`;
  const slot = new Date(`${datePart}T${hhmmss}+07:00`);
  if (Number.isNaN(slot.getTime())) return true;

  const nowFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = nowFmt.formatToParts(new Date());
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  const clinicNow = new Date(
    `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}T${byType.get("hour")}:${byType.get("minute")}:${byType.get("second")}+07:00`
  );
  if (Number.isNaN(clinicNow.getTime())) return true;
  return slot.getTime() <= clinicNow.getTime();
}

function parseBookingMetaFromNote(note: string | null): { gender: "male" | "female" | null; birthYear: string | null } {
  const text = (note || "").replace(/\s+/g, " ").trim();
  if (!text) return { gender: null, birthYear: null };
  const genderMatch = text.match(/(Gioi tinh|Giới tính):\s*([^]+?)(?=\s+(Nam sinh|Năm sinh):|\s+Ly do kham:|$)/i);
  const birthYearMatch = text.match(/(Nam sinh|Năm sinh):\s*(\d{4})/i);
  const rawGender = (genderMatch?.[2] || "").trim().toLowerCase();
  const gender = rawGender === "nu" || rawGender === "nữ" ? "female" : rawGender === "nam" ? "male" : null;
  return { gender, birthYear: birthYearMatch?.[2] || null };
}

export default function SpecialtyDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [invalidSlug, setInvalidSlug] = useState(false);
  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState(0);
  const [doctors, setDoctors] = useState<DoctorLite[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState(0);
  const [doctorDetail, setDoctorDetail] = useState<DoctorDetail | null>(null);
  const [workDate, setWorkDate] = useState(todayYMD());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState(0);
  const [prefillSlotId, setPrefillSlotId] = useState<number | null>(null);
  const [selectedTimeRangeKey, setSelectedTimeRangeKey] = useState("all");
  const [submitting, setSubmitting] = useState(false);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingMessage, setBookingMessage] = useState("");
  const [needLoginHint, setNeedLoginHint] = useState(false);
  const [authUser, setAuthUser] = useState<ReturnType<typeof getAuthUser>>(null);
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [doctorReviews, setDoctorReviews] = useState<DoctorReview[]>([]);
  const [bookingForm, setBookingForm] = useState<BookingForm>({
    full_name: "",
    phone: "",
    gender: "male",
    birth_year: "",
    reason: "",
  });

  async function loadSlots(doctorId: number, date: string, serviceId?: number) {
    if (!doctorId || !date) {
      setSlots([]);
      setSelectedSlotId(0);
      return;
    }
    const params = new URLSearchParams();
    params.set("date", date);
    if (serviceId && serviceId > 0) {
      params.set("service_id", String(serviceId));
    }
    const res = await apiClient.get<{ data: Slot[] }>(
      `/api/public/doctors/${doctorId}/schedule?${params.toString()}`
    );
    setSlots(res.data || []);
    setSelectedSlotId(0);
  }

  function showBookActionMessage(message: string, needsLogin = false) {
    setNeedLoginHint(needsLogin);
    showToast(message, "error");
  }

  async function openReviewsModal() {
    if (!selectedDoctorId) return;
    setShowReviewsModal(true);
    setReviewsLoading(true);
    try {
      const res = await apiClient.get<{ data: DoctorReview[] }>(
        `/api/public/doctors/${selectedDoctorId}/reviews`
      );
      setDoctorReviews(res.data || []);
    } catch {
      setDoctorReviews([]);
    } finally {
      setReviewsLoading(false);
    }
  }

  async function loadDoctorDetail(doctorId: number) {
    if (!doctorId) {
      setDoctorDetail(null);
      return;
    }
    const res = await apiClient.get<{ data: DoctorDetail }>(`/api/public/doctors/${doctorId}`);
    setDoctorDetail(res.data);
  }

  async function handleOpenBookingForm() {
    if (!selectedSlotId) {
      showBookActionMessage("Vui lòng chọn khung giờ khám trước khi đặt lịch.");
      return;
    }
    if (selectedSlot?.status !== "available") {
      showBookActionMessage("Khung giờ này đã đầy. Bạn có thể tham gia danh sách chờ.");
      return;
    }
    if (!workDate || !selectedSlot?.start_time || isSlotPastNow(workDate, selectedSlot.start_time)) {
      const message = "Khung gio nay da qua thoi diem dat lich.";
      showBookActionMessage(message);
      return;
    }

    const user = getAuthUser("patient");
    const token = getAccessToken("patient");
    if (!user || !token) {
      showBookActionMessage("Vui lòng đăng nhập để đặt lịch.", true);
      return;
    }
    if (user.role !== "patient") {
      showBookActionMessage("Chỉ tài khoản bệnh nhân mới được đặt lịch.");
      return;
    }
    setBookingError("");
    setBookingMessage("");
    setNeedLoginHint(false);

    const currentReason = bookingForm.reason;
    let prefill: UserProfile | null = null;
    let fallbackGender: "male" | "female" | null = null;
    let fallbackBirthYear: string | null = null;
    try {
      const profileRes = await apiClient.get<{ data: UserProfile }>("/api/profile", token);
      prefill = profileRes.data || null;
    } catch {
      prefill = null;
    }
    if (!prefill?.birth_year || !prefill?.gender) {
      try {
        const apptRes = await apiClient.get<{ data: PatientAppointmentLite[] }>(
          "/api/patient/appointments?status=all",
          token
        );
        const rows = apptRes.data || [];
        for (const row of rows) {
          const parsed = parseBookingMetaFromNote(row.note);
          if (!fallbackGender && parsed.gender) fallbackGender = parsed.gender;
          if (!fallbackBirthYear && parsed.birthYear) fallbackBirthYear = parsed.birthYear;
          if (fallbackGender && fallbackBirthYear) break;
        }
      } catch {
        // ignore fallback errors
      }
    }

    setBookingForm({
      full_name: prefill?.full_name || "",
      phone: prefill?.phone || "",
      gender: prefill?.gender === "female" ? "female" : prefill?.gender === "male" ? "male" : fallbackGender || "male",
      birth_year:
        prefill?.birth_year !== null && prefill?.birth_year !== undefined && String(prefill.birth_year).trim() !== ""
          ? String(prefill.birth_year).trim()
          : fallbackBirthYear || "",
      reason: currentReason || "",
    });
    setShowBookingForm(true);
  }

  function goToLoginFromCurrentPage() {
    if (typeof window === "undefined") {
      router.push("/login");
      return;
    }
    const next = `${window.location.pathname}${window.location.search}`;
    router.push(`/login?next=${encodeURIComponent(next)}`);
  }

  async function handleConfirmBooking() {
    if (!selectedSlotId) return;

    const user = getAuthUser("patient");
    const token = getAccessToken("patient");
    if (!user || !token) {
      setBookingError("Vui lòng đăng nhập để đặt lịch.");
      router.push("/login");
      return;
    }
    if (user.role !== "patient") {
      setBookingError("Chi tai khoan benh nhan moi duoc dat lich.");
      return;
    }

    const fullName = bookingForm.full_name.trim();
    const phone = bookingForm.phone.trim();
    const reason = bookingForm.reason.trim();
    const currentYear = new Date().getFullYear();
    const birthYear = Number(bookingForm.birth_year);

    if (!fullName || !phone || !bookingForm.birth_year.trim() || !reason) {
      setBookingError("Vui lòng nhập đầy đủ họ tên, số điện thoại, năm sinh và lý do khám.");
      return;
    }

    if (!/^[0-9+]{8,20}$/.test(phone)) {
      setBookingError("Số điện thoại không hợp lệ.");
      return;
    }

    if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear) {
      setBookingError("Năm sinh không hợp lệ.");
      return;
    }

    const genderLabel = bookingForm.gender === "male" ? "Nam" : "Nu";
    const note = [
      "[Thong tin dat lich]",
      `Ho va ten: ${fullName}`,
      `Số điện thoại: ${phone}`,
      `Giới tính: ${genderLabel}`,
      `Năm sinh: ${birthYear}`,
      `Lý do khám: ${reason}`,
    ].join("\n");

    try {
      setSubmitting(true);
      setBookingError("");
      setBookingMessage("");
      await apiClient.post("/api/patient/appointments", { slot_id: selectedSlotId, note }, token);
      await loadSlots(selectedDoctorId, workDate, effectiveServiceId);
      setShowBookingForm(false);
      setBookingMessage("Đặt lịch thành công.");
      showToast("Đặt lịch thành công.", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Đặt lịch thất bại";
      setBookingError(message);
      if (message.toLowerCase().includes("dang nhap") || message.toLowerCase().includes("token")) {
        router.push("/login");
      }
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const syncAuth = () => setAuthUser(getAuthUser("patient"));
    syncAuth();
    window.addEventListener("focus", syncAuth);
    window.addEventListener("storage", syncAuth);
    return () => {
      window.removeEventListener("focus", syncAuth);
      window.removeEventListener("storage", syncAuth);
    };
  }, []);

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

        const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
        const queryServiceId = Number(query?.get("service_id"));
        const hasQueryService = Number.isFinite(queryServiceId) && queryServiceId > 0;
        const queryDoctorId = Number(query?.get("doctor_id"));
        const hasQueryDoctor = Number.isFinite(queryDoctorId) && queryDoctorId > 0;
        const queryDate = query?.get("date") || "";
        const isQueryDateValid = /^\d{4}-\d{2}-\d{2}$/.test(queryDate);
        const querySlotId = Number(query?.get("slot_id"));
        const hasQuerySlot = Number.isFinite(querySlotId) && querySlotId > 0;

        if (isQueryDateValid) {
          setWorkDate(queryDate);
        }
        setPrefillSlotId(hasQuerySlot ? querySlotId : null);

        const doctorsUrl = hasQueryService
          ? `/api/public/doctors?specialty_id=${specialtyId}&service_id=${queryServiceId}`
          : `/api/public/doctors?specialty_id=${specialtyId}`;

        const [specialtiesRes, servicesRes, doctorsRes] = await Promise.all([
          apiClient.get<{ data: Specialty[] }>("/api/public/specialties"),
          apiClient.get<{ data: Service[] }>(`/api/public/services?specialty_id=${specialtyId}`),
          apiClient.get<{ data: DoctorLite[] }>(doctorsUrl),
        ]);

        const current = (specialtiesRes.data || []).find((s) => s.id === specialtyId) || null;
        if (!current) {
          setInvalidSlug(true);
          return;
        }
        setSpecialty(current);
        const serviceList = servicesRes.data || [];
        setServices(serviceList);
        if (hasQueryService && serviceList.some((s) => s.id === queryServiceId)) {
          setSelectedServiceId(queryServiceId);
        } else {
          setSelectedServiceId(0);
        }
        const list = doctorsRes.data || [];
        setDoctors(list);
        const canUseQueryDoctor = hasQueryDoctor ? list.some((d) => d.doctor_id === queryDoctorId) : false;

        if (canUseQueryDoctor) {
          setSelectedDoctorId(queryDoctorId);
        } else if (list[0]) {
          setSelectedDoctorId(list[0].doctor_id);
        } else {
          setSelectedDoctorId(0);
          setDoctorDetail(null);
        }
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [params]);

  useEffect(() => {
    if (!selectedDoctorId) return;
    loadDoctorDetail(selectedDoctorId).catch(() => setDoctorDetail(null));
  }, [selectedDoctorId]);

  const availableSlots = useMemo(() => slots.filter((s) => s.status === "available"), [slots]);
  const selectedSlot = useMemo(() => slots.find((s) => s.id === selectedSlotId) || null, [slots, selectedSlotId]);
  const selectedService = useMemo(
    () => services.find((s) => s.id === selectedServiceId) || null,
    [services, selectedServiceId]
  );
  const derivedService = useMemo(() => {
    if (selectedService) return selectedService;
    return null;
  }, [selectedService]);
  const effectiveServiceId = selectedServiceId > 0 ? selectedServiceId : 0;
  const specialtyPath = useMemo(() => {
    if (!specialty) return "/chuyen-khoa";
    return `/dich-vu/${slugify(specialty.name)}-s${specialty.id}`;
  }, [specialty]);
  const currentPath = useMemo(() => {
    if (!specialty) return "";
    const base = `/chuyen-khoa/${slugify(specialty.name)}-s${specialty.id}`;
    return derivedService ? `${base}?service_id=${derivedService.id}` : base;
  }, [specialty, derivedService]);
  const doctorServiceNames = useMemo(() => {
    if (!doctorDetail?.services?.length) return "Đang cập nhật";
    return doctorDetail.services.map((s) => s.service_name).join(", ");
  }, [doctorDetail]);
  const serviceOptions = useMemo(() => doctorDetail?.services || [], [doctorDetail]);
  const timeRangeOptions = useMemo(() => {
    if (slots.length === 0) return [] as TimeRangeOption[];

    const sorted = [...slots].sort((a, b) => a.start_time.localeCompare(b.start_time));
    const ranges: TimeRangeOption[] = [];

    let rangeStart = sorted[0].start_time;
    let rangeEnd = sorted[0].end_time;

    for (let i = 1; i < sorted.length; i += 1) {
      const current = sorted[i];
      if (current.start_time === rangeEnd) {
        rangeEnd = current.end_time;
      } else {
        ranges.push({
          key: `${rangeStart}|${rangeEnd}`,
          label: `${rangeStart.slice(0, 5)} - ${rangeEnd.slice(0, 5)}`,
          start: rangeStart,
          end: rangeEnd,
        });
        rangeStart = current.start_time;
        rangeEnd = current.end_time;
      }
    }

    ranges.push({
      key: `${rangeStart}|${rangeEnd}`,
      label: `${rangeStart.slice(0, 5)} - ${rangeEnd.slice(0, 5)}`,
      start: rangeStart,
      end: rangeEnd,
    });

    return ranges;
  }, [slots]);

  const visibleSlots = useMemo(() => {
    if (selectedTimeRangeKey === "all") return slots;
    const currentRange = timeRangeOptions.find((r) => r.key === selectedTimeRangeKey);
    if (!currentRange) return slots;
    return slots.filter(
      (slot) => slot.start_time >= currentRange.start && slot.end_time <= currentRange.end
    );
  }, [slots, selectedTimeRangeKey, timeRangeOptions]);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    if (selectedTimeRangeKey === "all") return;
    const exists = timeRangeOptions.some((r) => r.key === selectedTimeRangeKey);
    if (!exists) setSelectedTimeRangeKey("all");
  }, [timeRangeOptions, selectedTimeRangeKey]);

  useEffect(() => {
    if (!selectedSlotId) return;
    const stillVisible = visibleSlots.some((slot) => slot.id === selectedSlotId);
    if (!stillVisible) setSelectedSlotId(0);
  }, [visibleSlots, selectedSlotId]);

  useEffect(() => {
    if (!prefillSlotId || slots.length === 0) return;
    const matched = slots.find((slot) => slot.id === prefillSlotId);
    if (matched) {
      setSelectedSlotId(matched.id);
      setPrefillSlotId(null);
    }
  }, [slots, prefillSlotId]);

  useEffect(() => {
    if (!selectedDoctorId) return;
    loadSlots(selectedDoctorId, workDate, effectiveServiceId).catch(() => setSlots([]));
  }, [selectedDoctorId, workDate, effectiveServiceId]);

  if (loading) {
    return (
      <div className={styles.page}>
        <main className={styles.container}>
          <section className={styles.topBar}>Đang tải...</section>
        </main>
      </div>
    );
  }

  if (invalidSlug || !specialty) {
    return (
      <div className={styles.page}>
        <main className={styles.container}>
          <section className={styles.topBar}>
            Không tìm thấy chuyên khoa. <Link href="/chuyen-khoa">Về danh sách</Link>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <section className={styles.topBar}>
          <Breadcrumbs
            items={[
              { label: "Trang chủ", href: "/", home: true },
              { label: "Kham chuyên khoa", href: "/chuyen-khoa" },
              { label: specialty.name, href: specialtyPath },
              ...(derivedService ? [{ label: derivedService.name, href: currentPath }] : []),
              { label: doctorDetail?.full_name || "Chon bac si" },
            ]}
          />
        </section>

        <section className={styles.bookingCard}>
          <div className={styles.left}>
            <div className={styles.leftTop}>
              <img
                className={styles.avatar}
                src={resolveAvatarSrc(doctorDetail?.avatar || null)}
                alt="doctor"
                onError={(e) => {
                  e.currentTarget.src = DOCTOR_AVATAR_PLACEHOLDER;
                }}
              />
              <div>
                <h2 className={styles.doctorName}>{doctorDetail?.full_name || "Chon bac si"}</h2>
                <p className={styles.doctorSub}>
                  <strong>Khoa:</strong> {doctorDetail?.specialty_name || specialty.name}
                </p>
                <p className={styles.doctorSub}>
                  <strong>Dịch vụ khám:</strong> {doctorServiceNames}
                </p>
                {/* <p className={styles.doctorSub}>
                  {typeof doctorDetail?.experience === "number" ? `${doctorDetail.experience} nam kinh nghiem` : "Bac si chuyen khoa"}
                </p> */}
                <p className={styles.doctorSub}>
                  <strong>Đánh giá:</strong> {Number(doctorDetail?.rating_avg || 0).toFixed(1)} ({doctorDetail?.rating_count || 0})
                </p>
              </div>
            </div>

            <p className={styles.doctorInfo}>
              <strong>Mô tả bác sĩ:</strong>{" "}
              {doctorDetail?.description || "Bác sĩ chưa cập nhật mô tả hồ sơ."}
            </p>
            <button type="button" className={styles.reviewBtn} onClick={openReviewsModal}>
              Đánh giá
            </button>
          </div>

                    <div className={styles.right}>
            <div className={styles.headerRow}>
              <select
                className={styles.dateInput}
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(Number(e.target.value))}
              >
                <option value={0}>Tất cả dịch vụ</option>
                {serviceOptions.map((s) => (
                  <option key={s.service_id} value={s.service_id}>
                    {s.service_name}
                  </option>
                ))}
              </select>
              <select
                className={styles.dateInput}
                value={selectedTimeRangeKey}
                onChange={(e) => setSelectedTimeRangeKey(e.target.value)}
              >
                <option value="all">Tất cả khung giờ</option>
                {timeRangeOptions.map((range) => (
                  <option key={range.key} value={range.key}>
                    {range.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.headerRow}>
              <h3 className={styles.dateTitle}>{workDate}</h3>
              <input className={styles.dateInput} type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            </div>
            <p className={styles.label}>Lịch khám</p>

            <div className={styles.slotGrid}>
              {visibleSlots.map((slot) => {
                const disabled = slot.status === "closed" || isSlotPastNow(workDate, slot.start_time);
                const active = slot.id === selectedSlotId;
                return (
                  <button
                    key={slot.id}
                    className={`${styles.slotBtn} ${active ? styles.slotActive : ""} ${disabled ? styles.slotDisabled : ""} ${slot.status === "full" ? styles.slotFull : ""}`}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      setSelectedSlotId(slot.id);
                      setNeedLoginHint(false);
                    }}
                  >
                    {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                  </button>
                );
              })}
              {visibleSlots.length === 0 && (
                <div className={styles.descText}>Không có lịch khám phù hợp bộ lọc.</div>
              )}
            </div>

            <div className={styles.divider} />
            <p className={styles.descText}>
              Giá khám: {Number(selectedSlot?.price || visibleSlots[0]?.price || availableSlots[0]?.price || 0).toLocaleString("vi-VN")}đ
            </p>

            <button className={styles.bookBtn} onClick={handleOpenBookingForm} disabled={submitting}>
              {submitting ? "Đang đặt lịch..." : "Đặt lịch khám"}
            </button>
            {!authUser && needLoginHint ? (
              <button type="button" className={styles.loginNowBtn} onClick={goToLoginFromCurrentPage}>
                Đăng nhập để có thể đặt lịch
              </button>
            ) : null}
            {bookingMessage ? <p className={styles.successText}>{bookingMessage}</p> : null}
          </div>
        </section>

        <section className={styles.doctorList}>
          <p className={styles.label}>Danh sách bác sĩ</p>
          {doctors.length === 0 ? (
            <p className={styles.descText}>Chưa có bác sĩ phù hợp với bộ lọc hiện tại.</p>
          ) : (
            <div className={styles.doctorItems}>
              {doctors.map((d) => (
                <button
                  key={d.doctor_id}
                  className={`${styles.doctorBtn} ${selectedDoctorId === d.doctor_id ? styles.doctorBtnActive : ""}`}
                  onClick={() => setSelectedDoctorId(d.doctor_id)}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <img
                      src={resolveAvatarSrc(d.avatar || null)}
                      alt={d.full_name}
                      style={{ width: 38, height: 38, borderRadius: "999px", objectFit: "cover", border: "1px solid #cbd5e1" }}
                      onError={(e) => {
                        e.currentTarget.src = DOCTOR_AVATAR_PLACEHOLDER;
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 700 }}>{d.full_name}</div>
                      <div style={{ color: "#64748b", fontSize: 12 }}>
                        {d.doctor_code || "BS"} {typeof d.experience === "number" ? `| ${d.experience} nam` : ""}
                      </div>
                      <div style={{ color: "#0f766e", fontSize: 12 }}>
                        Đánh giá: {Number(d.rating_avg || 0).toFixed(1)} ({d.rating_count || 0})
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

      </main>
      {showBookingForm ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Xác nhận thông tin</h3>

            <label className={styles.formLabel}>Họ và tên</label>
            <input
              className={styles.formInput}
              value={bookingForm.full_name}
              onChange={(e) => setBookingForm((prev) => ({ ...prev, full_name: e.target.value }))}
              autoComplete="off"
            />

            <label className={styles.formLabel}>Số điện thoại</label>
            <input
              className={styles.formInput}
              value={bookingForm.phone}
              onChange={(e) => setBookingForm((prev) => ({ ...prev, phone: e.target.value }))}
              autoComplete="off"
            />

            <label className={styles.formLabel}>Giới tính</label>
            <select
              className={styles.formInput}
              value={bookingForm.gender}
              onChange={(e) =>
                setBookingForm((prev) => ({ ...prev, gender: e.target.value as "male" | "female" }))
              }
            >
              <option value="male">Nam</option>
              <option value="female">Nữ</option>
            </select>

            <label className={styles.formLabel}>Năm sinh</label>
            <input
              className={styles.formInput}
              type="number"
              min={1900}
              max={currentYear}
              step={1}
              value={bookingForm.birth_year}
              onChange={(e) => setBookingForm((prev) => ({ ...prev, birth_year: e.target.value }))}
              autoComplete="off"
            />

            <label className={styles.formLabel}>Lý do khám</label>
            <textarea
              className={styles.formTextArea}
              value={bookingForm.reason}
              onChange={(e) => setBookingForm((prev) => ({ ...prev, reason: e.target.value }))}
              autoComplete="off"
            />

            {bookingError ? <p className={styles.errorText}>{bookingError}</p> : null}

            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setShowBookingForm(false)} disabled={submitting}>
                Hủy
              </button>
              <button className={styles.confirmBtn} onClick={handleConfirmBooking} disabled={submitting}>
                {submitting ? "Đang xử lý..." : "Xác nhận đặt lịch"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showReviewsModal ? (
        <div className={styles.modalOverlay}>
          <div className={styles.reviewModalCard}>
            <h3 className={styles.modalTitle}>Danh sách đánh giá</h3>
            {reviewsLoading ? <p className={styles.descText}>Đang tải đánh giá...</p> : null}
            {!reviewsLoading && doctorReviews.length === 0 ? (
              <p className={styles.descText}>Chưa có đánh giá nào.</p>
            ) : null}
            {!reviewsLoading ? (
              <div className={styles.reviewList}>
                {doctorReviews.map((review) => (
                  <div key={review.id} className={styles.reviewItem}>
                    <p className={styles.reviewLine}>
                      <strong>Nguời đánh giá:</strong> {review.reviewer_name}
                    </p>
                    <p className={styles.reviewLine}>
                      <strong>Nội dung:</strong> {review.comment?.trim() || "(Không có nội dung)"}
                    </p>
                    <p className={styles.reviewLine}>
                      <strong>Số sao:</strong> {review.rating}/5
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelBtn} onClick={() => setShowReviewsModal(false)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
