"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./appointments.module.css";

type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
type StatusTab = "not_examined" | "completed" | "cancelled" | "no_show";

type AdminAppointmentItem = {
  id: number;
  user_id: number;
  status: AppointmentStatus | string;
  payment_status: "unpaid" | "paid";
  note: string | null;
  admin_note: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  patient_gender: string | null;
  patient_birth_year: number | null;
  doctor_id: number | null;
  doctor_name: string | null;
  doctor_code: string | null;
  service_id: number | null;
  service_name: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  paid_at: string | null;
  payment_amount: number | null;
  price?: number | null;
  cancelled_by_name: string | null;
  cancelled_by_role: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  no_show_at: string | null;
};

type ParsedBookingNote = {
  reason: string | null;
  gender: string | null;
  birthYear: string | null;
};

function formatDateTime(item: AdminAppointmentItem) {
  const rawDate = item.work_date || "";
  const datePart = rawDate.includes("T") ? rawDate.slice(0, 10) : rawDate;
  const formattedDate = /^\d{4}-\d{2}-\d{2}$/.test(datePart)
    ? `${datePart.slice(8, 10)}-${datePart.slice(5, 7)}-${datePart.slice(0, 4)}`
    : "-";
  const start = item.start_time ? item.start_time.slice(0, 5) : "--:--";
  const end = item.end_time ? item.end_time.slice(0, 5) : "--:--";
  return `${formattedDate} (${start} - ${end})`;
}

function formatEventDateTime(raw: string | null): string {
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

function formatMoneyVnd(amount: number | null): string {
  if (amount === null || Number.isNaN(Number(amount))) return "-";
  return `${new Intl.NumberFormat("vi-VN").format(Number(amount))} VND`;
}

function mapStatusLabel(tab: StatusTab) {
  if (tab === "not_examined") return "Chưa khám";
  if (tab === "completed") return "Đã khám";
  if (tab === "cancelled") return "Đã hủy";
  return "Vắng mặt";
}

function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_").trim();
}

function normalizeStatusText(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "pending" || normalized === "confirmed") return "Chưa khám";
  if (normalized === "completed") return "Đã khám";
  if (normalized === "cancelled") return "Đã hủy";
  return "Vắng mặt";
}

function getStatusBadgeClass(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "pending" || normalized === "confirmed") return styles.badgePending;
  if (normalized === "completed") return styles.badgeCompleted;
  if (normalized === "cancelled") return styles.badgeCancelled;
  return styles.badgeNoShow;
}

function parseBookingNote(note: string | null): ParsedBookingNote {
  if (!note) return { reason: null, gender: null, birthYear: null };
  const compact = note.replace(/\s+/g, " ").trim();
  const genderMatch = compact.match(
    /(Giới tính|Gioi tinh)\s*:\s*([^]+?)(?=\s+(Năm sinh|Nam sinh)\s*:|\s+(Lý do khám|Ly do kham)\s*:|$)/i
  );
  const birthYearMatch = compact.match(/(Năm sinh|Nam sinh)\s*:\s*(\d{4})/i);
  const reasonMatch = compact.match(
    /(Lý do khám|Ly do kham)\s*:\s*([^]+?)(?=\s+(Lý do hủy|Ly do huy)\s*:|$)/i
  );
  const fallbackReasonMatch = compact.match(/(Lý do|Ly do)\s*:\s*([^]+?)$/i);
  return {
    reason: reasonMatch?.[2]?.trim() || fallbackReasonMatch?.[2]?.trim() || note.trim(),
    gender: genderMatch?.[2]?.trim() || null,
    birthYear: birthYearMatch?.[2]?.trim() || null,
  };
}

function formatGenderLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const normalized = value.toLowerCase().trim();
  if (normalized === "male" || normalized === "nam" || normalized === "m") return "Nam";
  if (normalized === "female" || normalized === "nu" || normalized === "nữ" || normalized === "f") return "Nữ";
  return value;
}

function getExamReason(item: AdminAppointmentItem): string {
  const fromNote = parseBookingNote(item.note).reason;
  if (fromNote) return fromNote;
  return "-";
}

export default function AdminAppointmentsPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AdminAppointmentItem[]>([]);

  const [statusTab, setStatusTab] = useState<StatusTab>("not_examined");
  const [dateFilter, setDateFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [patientFilter, setPatientFilter] = useState("");

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const token = getAccessToken();
      const params = new URLSearchParams();
      if (dateFilter) params.set("date", dateFilter);
      if (serviceFilter) params.set("service_id", serviceFilter);
      if (doctorFilter) params.set("doctor_id", doctorFilter);
      if (patientFilter) params.set("patient_id", patientFilter);

      const query = params.toString();
      const res = await apiClient.get<{ data: AdminAppointmentItem[] }>(
        `/api/admin/appointments${query ? `?${query}` : ""}`,
        token
      );
      setItems(res.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể tải lịch hẹn", "error");
    } finally {
      setLoading(false);
    }
  }, [dateFilter, doctorFilter, patientFilter, serviceFilter, showToast]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const statusItems = useMemo(() => {
    if (statusTab === "not_examined") {
      return items.filter((x) => {
        const s = normalizeStatus(String(x.status));
        return s === "pending" || s === "confirmed";
      });
    }
    if (statusTab === "completed") {
      return items.filter((x) => normalizeStatus(String(x.status)) === "completed");
    }
    if (statusTab === "cancelled") {
      return items.filter((x) => normalizeStatus(String(x.status)) === "cancelled");
    }
    return items.filter((x) => {
      const s = normalizeStatus(String(x.status));
      return s === "no_show" || s === "noshow";
    });
  }, [items, statusTab]);

  const serviceOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of items) {
      if (item.service_id && item.service_name) map.set(item.service_id, item.service_name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const doctorOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of items) {
      if (item.doctor_id) {
        const code = item.doctor_code ? ` (${item.doctor_code})` : "";
        map.set(item.doctor_id, `${item.doctor_name || "Bác sĩ"}${code}`);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const patientOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of items) {
      if (item.user_id) {
        map.set(item.user_id, item.patient_name || `Bệnh nhân #${item.user_id}`);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  function resetFilters() {
    setStatusTab("not_examined");
    setDateFilter("");
    setServiceFilter("");
    setDoctorFilter("");
    setPatientFilter("");
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Quản lý lịch hẹn</h2>
      <div className={styles.mainGrid}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}>
            <h3 className={styles.sidebarTitle}>Bộ lọc</h3>
            <button type="button" className={styles.secondaryBtn} onClick={resetFilters}>
              Xóa lọc
            </button>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.label}>Trạng thái</label>
            <select
              className={styles.control}
              value={statusTab}
              onChange={(e) => setStatusTab(e.target.value as StatusTab)}
            >
              <option value="not_examined">Chưa khám</option>
              <option value="completed">Đã khám</option>
              <option value="cancelled">Đã hủy</option>
              <option value="no_show">Vắng mặt</option>
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.label}>Ngày khám</label>
            <input
              className={styles.control}
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.label}>Dịch vụ</label>
            <select
              className={styles.control}
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
            >
              <option value="">Tất cả dịch vụ</option>
              {serviceOptions.map(([id, service]) => (
                <option key={id} value={id}>
                  {service}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.label}>Bác sĩ</label>
            <select
              className={styles.control}
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
            >
              <option value="">Tất cả bác sĩ</option>
              {doctorOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.label}>Bệnh nhân</label>
            <select
              className={styles.control}
              value={patientFilter}
              onChange={(e) => setPatientFilter(e.target.value)}
            >
              <option value="">Tất cả bệnh nhân</option>
              {patientOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </aside>

        <section className={styles.content}>
          <h3 className={styles.sidebarTitle}>Danh sách: {mapStatusLabel(statusTab)}</h3>
          {loading ? (
            <p>Đang tải lịch hẹn...</p>
          ) : statusItems.length === 0 ? (
            <p className={styles.empty}>Không có lịch hẹn phù hợp.</p>
          ) : (
            <div className={styles.list}>
              {statusItems.map((item) => (
                <article key={item.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <span className={`${styles.badge} ${getStatusBadgeClass(String(item.status))}`}>
                      {normalizeStatusText(item.status)}
                    </span>
                  </div>

                  <div className={styles.grid}>
                    <div className={styles.col}>
                      {(() => {
                        const normalized = normalizeStatus(String(item.status));
                        const parsed = parseBookingNote(item.note);
                        const displayGender = formatGenderLabel(item.patient_gender || parsed.gender);
                        const displayBirthYear = item.patient_birth_year || parsed.birthYear || "-";
                        const displayReason = getExamReason(item);
                        return (
                          <>
                            <p><strong>Bệnh nhân:</strong> {item.patient_name || "-"}</p>
                            <p><strong>Số điện thoại:</strong> {item.patient_phone || "-"}</p>
                            <p><strong>Giới tính:</strong> {displayGender}</p>
                            <p><strong>Năm sinh:</strong> {displayBirthYear}</p>
                            <p><strong>Lý do khám:</strong> {displayReason}</p>
                            {normalized === "completed" && item.payment_status === "paid" ? (
                              <>
                                <p><strong>Thời gian thanh toán:</strong> {formatEventDateTime(item.paid_at)}</p>
                                <p>
                                  <strong>Số tiền thanh toán:</strong>{" "}
                                  {formatMoneyVnd(item.payment_amount ?? item.price ?? null)}
                                </p>
                              </>
                            ) : null}
                          </>
                        );
                      })()}
                      {normalizeStatus(String(item.status)) === "completed" ? (
                        <p>
                          <strong>Thanh toán:</strong>{" "}
                          {item.payment_status === "paid" ? "Đã thanh toán" : "Chưa thanh toán"}
                        </p>
                      ) : null}
                      {normalizeStatus(String(item.status)) === "cancelled" ? (
                        <>
                          <p><strong>Trạng thái hủy:</strong> Đã hủy</p>
                          <p><strong>Thời gian hủy:</strong> {formatEventDateTime(item.cancelled_at)}</p>
                          <p>
                            <strong>Người hủy:</strong>{" "}
                            {item.cancelled_by_name
                              ? `${item.cancelled_by_name}${item.cancelled_by_role ? ` (${item.cancelled_by_role})` : ""}`
                              : "Không rõ"}
                          </p>
                          <p><strong>Lý do hủy:</strong> {item.cancellation_reason || "-"}</p>
                        </>
                      ) : null}
                      {normalizeStatus(String(item.status)) === "no_show" ? (
                        <>
                          <p><strong>Trạng thái:</strong> Vắng mặt</p>
                          <p><strong>Thời gian vắng mặt:</strong> {formatEventDateTime(item.no_show_at)}</p>
                        </>
                      ) : null}
                    </div>

                    <div className={styles.col}>
                      <p>
                        <strong>Bác sĩ:</strong>{" "}
                        {item.doctor_name || "-"}
                        {item.doctor_code ? ` (${item.doctor_code})` : ""}
                      </p>
                      <p><strong>Dịch vụ:</strong> {item.service_name || "-"}</p>
                      <p><strong>Phòng khám:</strong> {item.room || "-"}</p>
                      <p><strong>Thời gian khám:</strong> {formatDateTime(item)}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
