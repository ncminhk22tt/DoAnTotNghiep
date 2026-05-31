"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./appointments.module.css";

type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

type StatusFilter = "all" | "pending_confirmed" | "completed" | "no_show" | "cancelled";

type AppointmentRow = {
  id: number;
  user_id: number;
  slot_id: number | null;
  doctor_id: number | null;
  status: AppointmentStatus;
  note: string | null;
  admin_note: string | null;
  created_at: string;
  patient_name: string | null;
  patient_phone: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  service_id: number | null;
  service_name: string | null;
};

type AppointmentDetail = AppointmentRow & {
  patient_email: string | null;
  exam_allowed?: boolean;
  medical_records?: Array<{
    id: number;
    diagnosis: string | null;
    notes: string | null;
    created_at: string | null;
    prescriptions?: Array<{
      id: number;
      medical_record_id: number;
      items: Array<{
        id: number;
        prescription_id: number;
        medicine_name: string;
        dosage: string;
        duration: string;
      }>;
    }>;
  }>;
};

type DoctorService = {
  id: number;
  name: string;
  specialty_id: number | null;
  specialty_name: string | null;
  description: string | null;
};

type BookingMeta = {
  full_name: string | null;
  phone: string | null;
  gender: string | null;
  birth_year: string | null;
  reason: string | null;
};

type PrescriptionInput = {
  medicine_name: string;
  dosage: string;
  duration: string;
};

type NormalizedPrescriptionItem = {
  medicine_name: string;
  dosage: string;
  duration: string;
};

const DOSAGE_OPTIONS = Array.from({ length: 10 }, (_, idx) => String(idx + 1));
const DURATION_OPTIONS = [
  "Sáng",
  "Trưa",
  "Chiều",
  "Tối",
  "Sáng - Trưa",
  "Sáng - Chiều",
  "Sáng - Tối",
  "Trưa - Chiều",
  "Trưa - Tối",
  "Chiều - Tối",
  "Sáng - Trưa - Chiều",
  "Sáng - Trưa - Tối",
  "Sáng - Chiều - Tối",
  "Trưa - Chiều - Tối",
  "Sáng - Trưa - Chiều - Tối",
  "Theo chỉ định của bác sĩ",
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "pending_confirmed", label: "Chưa khám" },
  { value: "completed", label: "Đã khám" },
  { value: "no_show", label: "Vắng mặt" },
  { value: "cancelled", label: "Hủy" },
];

function parseCancelInfo(adminNote: string | null): { cancelledBy: string; cancelReason: string } {
  const value = (adminNote || "").trim();
  if (!value) return { cancelledBy: "-", cancelReason: "-" };

  if (value.startsWith("[Bệnh nhân hủy]") || value.startsWith("[Benh nhan huy]")) {
    return {
      cancelledBy: "Bệnh nhân",
      cancelReason: value.replace("[Bệnh nhân hủy]", "").replace("[Benh nhan huy]", "").trim() || "-",
    };
  }

  if (value.startsWith("[Bác sĩ hủy]") || value.startsWith("[Bac si huy]")) {
    return {
      cancelledBy: "Bác sĩ",
      cancelReason: value.replace("[Bác sĩ hủy]", "").replace("[Bac si huy]", "").trim() || "-",
    };
  }

  if (value.startsWith("[Admin hủy]") || value.startsWith("[Admin huy]")) {
    return {
      cancelledBy: "Admin",
      cancelReason: value.replace("[Admin hủy]", "").replace("[Admin huy]", "").trim() || "-",
    };
  }

  return { cancelledBy: "Khác", cancelReason: value };
}

function hasCancelInfo(adminNote: string | null): boolean {
  return Boolean(adminNote && adminNote.trim());
}

function statusLabel(status: AppointmentStatus) {
  if (status === "pending" || status === "confirmed") return "Chưa khám";
  if (status === "completed") return "Đã khám";
  if (status === "no_show") return "Vắng mặt";
  return "Hủy";
}

function formatClinicDate(date: string | null): string {
  if (!date) return "";
  const parsed = new Date(date);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(parsed);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-");
    return `${day}-${month}-${year}`;
  }

  return date.slice(0, 10);
}

function formatDateTime(date: string | null, start: string | null, end: string | null) {
  const dateText = formatClinicDate(date);
  if (!dateText) return "-";
  const timeRange = start && end ? `${start.slice(0, 5)} - ${end.slice(0, 5)}` : "-";
  return `${dateText} (${timeRange})`;
}

type ClinicDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getClinicDateTimeParts(date = new Date()): ClinicDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  type DateTimePartType = Intl.DateTimeFormatPart["type"];
  const get = (type: DateTimePartType) => Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function toClinicDateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return formatClinicDate(value.toISOString());
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return formatClinicDate(value);
  }
  return String(value).slice(0, 10);
}

function toClinicTimeString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(value);
  }
  return String(value).slice(0, 5);
}

function compareClinicDateTime(dateValue: unknown, timeValue: unknown) {
  const dateText = toClinicDateString(dateValue);
  const timeText = toClinicTimeString(timeValue);
  if (!dateText || !timeText) return Number.NaN;
  const [year, month, day] = dateText.split("-").map((value) => Number(value));
  const [hour, minute] = timeText.split(":").map((value) => Number(value));
  if ([year, month, day, hour, minute].some((value) => !Number.isFinite(value))) return Number.NaN;
  return ((year * 100 + month) * 100 + day) * 10000 + hour * 100 + minute;
}

function isAppointmentTimePassed(workDate: unknown, endTime: unknown) {
  const appointmentTime = compareClinicDateTime(workDate, endTime);
  if (!Number.isFinite(appointmentTime)) return false;
  const now = getClinicDateTimeParts();
  const currentTime = ((now.year * 100 + now.month) * 100 + now.day) * 10000 + now.hour * 100 + now.minute;
  return appointmentTime <= currentTime;
}

function isAppointmentStartReached(workDate: unknown, startTime: unknown) {
  const appointmentTime = compareClinicDateTime(workDate, startTime);
  if (!Number.isFinite(appointmentTime)) return false;
  const now = getClinicDateTimeParts();
  const currentTime = ((now.year * 100 + now.month) * 100 + now.day) * 10000 + now.hour * 100 + now.minute;
  return appointmentTime <= currentTime;
}

function parseBookingMeta(note: string | null): BookingMeta {
  const empty: BookingMeta = {
    full_name: null,
    phone: null,
    gender: null,
    birth_year: null,
    reason: null,
  };
  if (!note) return empty;

  const lines = note
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const readByPrefix = (prefix: string) => {
    const found = lines.find((x) => x.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!found) return null;
    const value = found.slice(prefix.length).trim();
    return value || null;
  };

  const normalizeGender = (value: string | null) => {
    if (!value) return null;
    const compact = value.toLowerCase().replace(/\s+/g, "");
    if (compact === "nu") return "nữ";
    if (compact === "nam") return "Nam";
    return value;
  };

  return {
    full_name: readByPrefix("Họ và tên:") || readByPrefix("Ho va ten:"),
    phone: readByPrefix("Số điện thoại:") || readByPrefix("So dien thoai:"),
    gender: normalizeGender(readByPrefix("Giới tính:") || readByPrefix("Gioi tinh:")),
    birth_year: readByPrefix("Năm sinh:") || readByPrefix("Nam sinh:"),
    reason: readByPrefix("Lý do khám:") || readByPrefix("Ly do kham:"),
  };
}

function validatePrescriptionItems(items: PrescriptionInput[]) {
  const normalized: NormalizedPrescriptionItem[] = items.map((item) => ({
    medicine_name: item.medicine_name.trim(),
    dosage: item.dosage.trim(),
    duration: item.duration.trim(),
  }));

  const hasPartialRow = normalized.some((item) => {
    const filled = [item.medicine_name, item.dosage, item.duration].filter(Boolean).length;
    return filled > 0 && filled < 3;
  });

  const validItems = normalized.filter((item) => item.medicine_name && item.dosage && item.duration);

  return { hasPartialRow, validItems };
}

export default function DoctorAppointmentsPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<AppointmentRow[]>([]);
  const [services, setServices] = useState<DoctorService[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showExamForm, setShowExamForm] = useState(false);
  const [diagnosis, setDiagnosis] = useState("");
  const [examNotes, setExamNotes] = useState("");
  const [prescriptionItems, setPrescriptionItems] = useState<PrescriptionInput[]>([
    { medicine_name: "", dosage: "", duration: "" },
  ]);
  const [submittingExam, setSubmittingExam] = useState(false);
  const [checkingExamStart, setCheckingExamStart] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);
  const [noShowModal, setNoShowModal] = useState<{
    appointmentId: number;
    patientName: string;
    workDate: string | null;
    endTime: string | null;
  } | null>(null);
  const [cancelModal, setCancelModal] = useState<{ appointmentId: number; reason: string } | null>(null);
  const [clockTick, setClockTick] = useState(0);

  const loadAppointments = useCallback(
    async (options?: { background?: boolean }) => {
      try {
        if (!options?.background) {
          setLoading(true);
        }
        const token = getAccessToken();
        const params = new URLSearchParams();
        if (statusFilter !== "all") params.set("status", statusFilter);
        if (dateFilter) params.set("date", dateFilter);
        if (serviceFilter > 0) params.set("service_id", String(serviceFilter));

        const query = params.toString();
        const res = await apiClient.get<{ data: AppointmentRow[] }>(
          `/api/doctor/appointments${query ? `?${query}` : ""}`,
          token
        );
        setItems(res.data || []);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Không thể tải lịch hẹn", "error");
      } finally {
        if (!options?.background) {
          setLoading(false);
        }
      }
    },
    [statusFilter, dateFilter, serviceFilter, showToast]
  );

  const loadServices = useCallback(async () => {
    try {
      const token = getAccessToken();
      const res = await apiClient.get<{ data: DoctorService[] }>("/api/doctor/services", token);
      setServices(res.data || []);
    } catch {
      setServices([]);
    }
  }, []);

  async function openDetail(appointmentId: number) {
    try {
      setShowExamForm(false);
      setShowCompleteConfirm(false);
      setNoShowModal(null);
      setSelectedAppointmentId(appointmentId);
      setDetailLoading(true);
      const token = getAccessToken();
      const res = await apiClient.get<{ data: AppointmentDetail }>(
        `/api/doctor/appointments/${appointmentId}`,
        token
      );
      setDetail(res.data);
      setDiagnosis("");
      setExamNotes("");
      setPrescriptionItems([{ medicine_name: "", dosage: "", duration: "" }]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể tải chi tiết lịch hẹn", "error");
    } finally {
      setDetailLoading(false);
    }
  }

  function updatePrescriptionItem(index: number, field: keyof PrescriptionInput, value: string) {
    setPrescriptionItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  function addPrescriptionItem() {
    setPrescriptionItems((prev) => [...prev, { medicine_name: "", dosage: "", duration: "" }]);
  }

  function removePrescriptionItem(index: number) {
    setPrescriptionItems((prev) => {
      if (prev.length <= 1) return [{ medicine_name: "", dosage: "", duration: "" }];
      return prev.filter((_, i) => i !== index);
    });
  }

  async function submitExam() {
    if (!selectedAppointmentId) return;
    if (!diagnosis.trim()) {
      showToast("Vui lòng nhập chẩn đoán", "error");
      return;
    }

    const { hasPartialRow, validItems: validPrescriptionItems } = validatePrescriptionItems(prescriptionItems);
    if (hasPartialRow) {
      showToast("Thông tin thuốc chưa đầy đủ. Mỗi dòng cần đủ tên thuốc, liều và thời gian dùng.", "error");
      return;
    }

    try {
      setSubmittingExam(true);
      const token = getAccessToken();
      const examRes = await apiClient.post<{ data?: { medical_record_id?: number } }>(
        `/api/doctor/appointments/${selectedAppointmentId}/exam`,
        { diagnosis: diagnosis.trim(), notes: examNotes.trim() || null },
        token
      );

      const medicalRecordId = Number(examRes?.data?.medical_record_id || 0);

      if (medicalRecordId > 0 && validPrescriptionItems.length > 0) {
        await apiClient.post(
          `/api/doctor/medical-records/${medicalRecordId}/prescriptions`,
          { items: validPrescriptionItems },
          token
        );
      }

      showToast("Lưu kết quả khám thành công", "success");
      setShowExamForm(false);
      setDiagnosis("");
      setExamNotes("");
      setPrescriptionItems([{ medicine_name: "", dosage: "", duration: "" }]);
      await loadAppointments();
      await openDetail(selectedAppointmentId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể lưu kết quả khám", "error");
    } finally {
      setSubmittingExam(false);
    }
  }

  async function startExamFromDetail() {
    if (!selectedAppointmentId || !detail) return;

    try {
      setCheckingExamStart(true);
      const token = getAccessToken();
      const res = await apiClient.get<{ data: AppointmentDetail }>(
        `/api/doctor/appointments/${selectedAppointmentId}`,
        token
      );
      const latestDetail = res.data;
      setDetail(latestDetail);

      const allowedByTime = isAppointmentStartReached(latestDetail.work_date, latestDetail.start_time);
      const allowedByServer = latestDetail.exam_allowed !== false;
      if (!allowedByTime || !allowedByServer) {
        setShowExamForm(false);
        showToast("Chỉ được khám bệnh từ giờ bắt đầu lịch khám trở đi.", "error");
        return;
      }

      setShowExamForm(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể kiểm tra giờ khám", "error");
    } finally {
      setCheckingExamStart(false);
    }
  }

  function requestCompleteExam() {
    if (!canStartExam) {
      showToast("Chỉ được khám bệnh từ giờ bắt đầu lịch khám trở đi.", "error");
      return;
    }
    if (!diagnosis.trim()) {
      showToast("Vui lòng nhập chẩn đoán", "error");
      return;
    }
    const { hasPartialRow } = validatePrescriptionItems(prescriptionItems);
    if (hasPartialRow) {
      showToast("Thông tin thuốc chưa đầy đủ. Mỗi dòng cần đủ tên thuốc, liều và thời gian dùng.", "error");
      return;
    }
    setShowCompleteConfirm(true);
  }

  async function updateStatus(appointmentId: number, status: AppointmentStatus, reason?: string) {
    try {
      setUpdatingStatusId(appointmentId);
      const token = getAccessToken();
      await apiClient.patch(
        `/api/doctor/appointments/${appointmentId}`,
        { status, decision_note: reason?.trim() || null },
        token
      );
      showToast(status === "cancelled" ? "Hủy lịch khám thành công" : "Cập nhật trạng thái thành công", "success");
      await loadAppointments();
      if (selectedAppointmentId === appointmentId) {
        await openDetail(appointmentId);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể cập nhật trạng thái", "error");
    } finally {
      setUpdatingStatusId(null);
    }
  }

  function clearFilters() {
    setStatusFilter("all");
    setDateFilter("");
    setServiceFilter(0);
  }

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  useEffect(() => {
    const refresh = () => {
      void loadAppointments({ background: true });
    };

    const timer = window.setInterval(refresh, 15000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadAppointments]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockTick((value) => value + 1);
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const detailBookingMeta = useMemo(() => parseBookingMeta(detail?.note || null), [detail?.note]);
  const latestMedicalRecord = useMemo(() => detail?.medical_records?.[0] || null, [detail?.medical_records]);
  const latestPrescriptionItems = useMemo(
    () => latestMedicalRecord?.prescriptions?.[0]?.items || [],
    [latestMedicalRecord]
  );
  const canStartExam = Boolean(
    detail && isAppointmentStartReached(detail.work_date, detail.start_time) && detail.exam_allowed !== false
  );
  const shouldRenderExamForm = showExamForm && canStartExam;
  const hasStructuredBookingMeta = useMemo(
    () =>
      Boolean(
        detailBookingMeta.full_name ||
          detailBookingMeta.phone ||
          detailBookingMeta.gender ||
          detailBookingMeta.birth_year ||
          detailBookingMeta.reason
      ),
    [detailBookingMeta]
  );

  return (
    <div className={styles.page} data-clock-tick={clockTick}>
      <h2 className={styles.title}>Lịch hẹn khám bệnh</h2>

      <section className={styles.filterCard}>
        <div className={styles.filterRow}>
          <div className={styles.field}>
            <label className={styles.label}>Trạng thái</label>
            <select
              className={`${styles.input} ${styles.selectInput}`}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              {STATUS_OPTIONS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Ngày khám</label>
            <input
              type="date"
              className={styles.input}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Dịch vụ</label>
            <select
              className={`${styles.input} ${styles.selectInput}`}
              value={serviceFilter}
              onChange={(e) => setServiceFilter(Number(e.target.value))}
            >
              <option value={0}>Tất cả dịch vụ</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.filterActions}>
            <button className={styles.secondaryBtn} type="button" onClick={clearFilters}>
              Xóa lọc
            </button>
          </div>
        </div>
      </section>

      <div className={styles.listContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Bệnh nhân</th>
              <th className={styles.th}>Số điện thoại</th>
              <th className={styles.th}>Dịch vụ</th>
              <th className={styles.th}>Lịch khám</th>
              <th className={styles.th}>Phòng</th>
              <th className={styles.th}>Trạng thái</th>
              <th className={`${styles.th} ${styles.actionHeader}`}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={styles.td}>
                  <div>{parseBookingMeta(item.note).full_name || item.patient_name || "-"}</div>
                </td>
                <td className={styles.td}>
                  <div>{parseBookingMeta(item.note).phone || item.patient_phone || "-"}</div>
                </td>
                <td className={styles.td}>
                  <div>{item.service_name || "-"}</div>
                </td>
                <td className={styles.td}>
                  <div>{formatDateTime(item.work_date, item.start_time, item.end_time)}</div>
                </td>
                <td className={styles.td}>
                  <div>{item.room || "-"}</div>
                </td>
                <td className={styles.td}>
                  <span className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`}>
                    {statusLabel(item.status)}
                  </span>
                </td>
                <td className={`${styles.td} ${styles.actionCell}`}>
                  <div className={styles.actionGroup}>
                    <button className={styles.infoBtn} onClick={() => openDetail(item.id)}>
                      Xem chi tiết
                    </button>
                    {(item.status === "pending" || item.status === "confirmed") ? (
                      (() => {
                        const canMarkNoShow = isAppointmentTimePassed(item.work_date, item.end_time);
                        return (
                          <button
                            className={styles.secondaryBtn}
                            disabled={updatingStatusId === item.id}
                            onClick={() =>
                              setNoShowModal({
                                appointmentId: item.id,
                                patientName: parseBookingMeta(item.note).full_name || item.patient_name || "-",
                                workDate: item.work_date,
                                endTime: item.end_time,
                              })
                            }
                            title={
                              canMarkNoShow
                                ? "Đánh dấu vắng mặt"
                                : "Chỉ được xác nhận vắng mặt sau khi giờ khám kết thúc"
                            }
                          >
                            Vắng mặt
                          </button>
                        );
                      })()
                    ) : null}
                    {(item.status === "pending" || item.status === "confirmed") ? (
                      <button
                        className={styles.dangerBtn}
                        disabled={updatingStatusId === item.id}
                        title={
                          isAppointmentStartReached(item.work_date, item.start_time)
                            ? "Không thể hủy khi đã tới giờ khám"
                            : "Hủy lịch hẹn"
                        }
                        onClick={() => {
                          if (isAppointmentStartReached(item.work_date, item.start_time)) {
                            showToast("Không thể hủy lịch hẹn khi đã tới giờ khám.", "error");
                            return;
                          }
                          setCancelModal({ appointmentId: item.id, reason: "" });
                        }}
                      >
                        Hủy
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td className={styles.emptyCell} colSpan={7}>
                  Chưa có lịch hẹn nào phù hợp bộ lọc.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedAppointmentId ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Chi tiết lịch hẹn</h3>

            {detailLoading || !detail ? (
              <div className={styles.modalText}>Đang tải chi tiết...</div>
            ) : (
              <>
                {hasStructuredBookingMeta ? (
                  <div className={styles.noteBlock}>
                    <div className={styles.noteTitle}>Thông tin bệnh nhân</div>
                    <div className={styles.noteContent}>
                      <div>
                        <strong>Họ và tên:</strong> {detailBookingMeta.full_name || detail.patient_name || "-"}
                      </div>
                      <div>
                        <strong>Số điện thoại:</strong> {detailBookingMeta.phone || detail.patient_phone || "-"}
                      </div>
                      <div>
                        <strong>Giới tính:</strong> {detailBookingMeta.gender || "-"}
                      </div>
                      <div>
                        <strong>Năm sinh:</strong> {detailBookingMeta.birth_year || "-"}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className={styles.detailGrid}>
                  {!hasStructuredBookingMeta ? <div><strong>Bệnh nhân:</strong> {detail.patient_name || "-"}</div> : null}
                  {!hasStructuredBookingMeta ? <div><strong>Điện thoại:</strong> {detail.patient_phone || "-"}</div> : null}
                  <div><strong>Dịch vụ:</strong> {detail.service_name || "-"}</div>
                  <div><strong>Trạng thái:</strong> {statusLabel(detail.status)}</div>
                  <div><strong>Lịch khám:</strong> {formatDateTime(detail.work_date, detail.start_time, detail.end_time)}</div>
                  {detail.status === "cancelled" && hasCancelInfo(detail.admin_note) ? (
                    <>
                      <div><strong>Bên hủy:</strong> {parseCancelInfo(detail.admin_note).cancelledBy}</div>
                      <div><strong>Lý do hủy:</strong> {parseCancelInfo(detail.admin_note).cancelReason}</div>
                    </>
                  ) : null}
                </div>

                <div className={styles.noteBlock}>
                  <div className={styles.noteTitle}>Lý do khám</div>
                  <div className={styles.noteContent}>
                    {detailBookingMeta.reason || (!hasStructuredBookingMeta ? detail.note || "-" : "-")}
                  </div>
                </div>

                {detail.status === "completed" && latestMedicalRecord ? (
                  <div className={styles.noteBlock}>
                    <div className={styles.noteTitle}>Thông tin khám đã hoàn thành</div>
                    <div className={styles.noteContent}>
                      <div><strong>Chẩn đoán:</strong> {latestMedicalRecord.diagnosis || "-"}</div>
                      <div><strong>Ghi chú khám:</strong> {latestMedicalRecord.notes || "-"}</div>
                      <div><strong>Danh sách thuốc:</strong></div>
                      {latestPrescriptionItems.length > 0 ? (
                        <div className={styles.prescriptionTableWrap}>
                          <table className={styles.prescriptionTable}>
                            <thead>
                              <tr>
                                <th className={styles.prescriptionTh}>Tên thuốc</th>
                                <th className={styles.prescriptionTh}>Liều</th>
                                <th className={styles.prescriptionTh}>Thời gian dùng</th>
                              </tr>
                            </thead>
                            <tbody>
                              {latestPrescriptionItems.map((item) => (
                                <tr key={item.id}>
                                  <td className={styles.prescriptionTd}>{item.medicine_name}</td>
                                  <td className={styles.prescriptionTd}>{item.dosage}</td>
                                  <td className={styles.prescriptionTd}>{item.duration}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div>- Chưa kê thuốc.</div>
                      )}
                    </div>
                  </div>
                ) : null}

                {shouldRenderExamForm ? (
                  <div className={styles.examForm}>
                    <div className={styles.field}>
                      <label className={styles.label}>Chẩn đoán</label>
                      <textarea
                        className={styles.textarea}
                        value={diagnosis}
                        onChange={(e) => setDiagnosis(e.target.value)}
                        placeholder="Nhập chẩn đoán sau khi khám"
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Ghi chú khám bệnh</label>
                      <textarea
                        className={styles.textarea}
                        value={examNotes}
                        onChange={(e) => setExamNotes(e.target.value)}
                        placeholder="Nhập ghi chú thêm (nếu có)"
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Kê thuốc</label>
                      <div style={{ display: "grid", gap: 8 }}>
                        {prescriptionItems.map((item, idx) => (
                          <div
                            key={`med-${idx}`}
                            style={{
                              display: "grid",
                              gap: 8,
                              gridTemplateColumns: "repeat(3, minmax(0, 1fr)) auto",
                              alignItems: "start",
                            }}
                          >
                            <input
                              className={styles.input}
                              style={{ minWidth: 0 }}
                              value={item.medicine_name}
                              onChange={(e) => updatePrescriptionItem(idx, "medicine_name", e.target.value)}
                              placeholder="Tên thuốc"
                            />
                            <details className={styles.inlineDropdown}>
                              <summary className={styles.inlineDropdownSummary}>
                                {item.dosage || "Liều"}
                              </summary>
                              <div className={styles.inlineDropdownMenu}>
                                {DOSAGE_OPTIONS.map((n) => (
                                  <button
                                    key={`dose-${n}`}
                                    type="button"
                                    className={styles.inlineDropdownItem}
                                    onClick={(e) => {
                                      updatePrescriptionItem(idx, "dosage", n);
                                      const detailsEl = e.currentTarget.closest("details");
                                      if (detailsEl) detailsEl.open = false;
                                    }}
                                  >
                                    {n}
                                  </button>
                                ))}
                              </div>
                            </details>
                            <select
                              className={styles.input}
                              style={{ minWidth: 0 }}
                              value={item.duration}
                              onChange={(e) => updatePrescriptionItem(idx, "duration", e.target.value)}
                            >
                              <option value="">Thời gian dùng</option>
                              {DURATION_OPTIONS.map((x) => (
                                <option key={`dur-${x}`} value={x}>
                                  {x}
                                </option>
                              ))}
                            </select>
                            <button
                              className={styles.secondaryBtn}
                              style={{ height: 46 }}
                              onClick={() => removePrescriptionItem(idx)}
                              type="button"
                            >
                              Xóa
                            </button>
                          </div>
                        ))}
                        <div>
                          <button className={styles.infoBtn} onClick={addPrescriptionItem} type="button">
                            + Thêm thuốc
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className={styles.modalActions}>
                      <button
                        className={styles.secondaryBtn}
                        onClick={() => {
                          setShowExamForm(false);
                          setShowCompleteConfirm(false);
                        }}
                        disabled={submittingExam}
                      >
                        Hủy form
                      </button>
                      <button
                        className={styles.primaryBtn}
                        onClick={requestCompleteExam}
                        disabled={submittingExam}
                      >
                        Hoàn thành
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}

            <div className={styles.modalActions}>
                {detail && (detail.status === "pending" || detail.status === "confirmed") ? (
                  <button
                    className={styles.primaryBtn}
                    disabled={checkingExamStart}
                    title={canStartExam ? "Mở form khám bệnh" : "Chỉ được khám bệnh từ giờ bắt đầu lịch khám"}
                    onClick={startExamFromDetail}
                  >
                    {checkingExamStart ? "Đang kiểm tra..." : "Khám bệnh"}
                  </button>
              ) : null}
              <button
                className={styles.secondaryBtn}
                onClick={() => {
                  setSelectedAppointmentId(null);
                  setDetail(null);
                  setShowExamForm(false);
                  setShowCompleteConfirm(false);
                  setNoShowModal(null);
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCompleteConfirm ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard} style={{ width: "min(520px, 95vw)" }}>
            <h3 className={styles.modalTitle}>Xác nhận hoàn thành</h3>
            <p>
              Bạn có chắc muốn hoàn thành lượt khám này và lưu kết quả khám không?
            </p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setShowCompleteConfirm(false)}>
                Hủy
              </button>
              <button
                className={styles.primaryBtn}
                disabled={submittingExam}
                onClick={async () => {
                  setShowCompleteConfirm(false);
                  await submitExam();
                }}
              >
                {submittingExam ? "Đang lưu..." : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {noShowModal ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard} style={{ width: "min(520px, 95vw)" }}>
            <h3 className={styles.modalTitle}>Xác nhận vắng mặt</h3>
            <p>
              Bạn có chắc muốn đánh dấu lịch hẹn của <strong>{noShowModal.patientName}</strong> là
              <strong> vắng mặt</strong> không?
            </p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setNoShowModal(null)}>
                Hủy 
              </button>
              <button
                className={styles.dangerBtn}
                disabled={updatingStatusId === noShowModal.appointmentId}
                onClick={async () => {
                  const appointmentId = noShowModal.appointmentId;
                  setNoShowModal(null);
                  await updateStatus(appointmentId, "no_show");
                }}
              >
                {updatingStatusId === noShowModal.appointmentId ? "Đang xử lý..." : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelModal ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard} style={{ width: "min(520px, 95vw)" }}>
            <h3 className={styles.modalTitle}>Hủy lịch hẹn</h3>
            <textarea
              className={styles.textarea}
              value={cancelModal.reason}
              onChange={(e) =>
                setCancelModal((prev) => (prev ? { ...prev, reason: e.target.value } : prev))
              }
              placeholder="Nhập lý do hủy lịch"
            />
            <div className={styles.modalActions}>
              <button
                className={styles.secondaryBtn}
                onClick={() => setCancelModal(null)}
                disabled={updatingStatusId === cancelModal.appointmentId}
              >
                Đóng
              </button>
              <button
                className={styles.dangerBtn}
                disabled={updatingStatusId === cancelModal.appointmentId}
                onClick={async () => {
                  if (!cancelModal.reason.trim()) {
                    showToast("Vui lòng nhập lý do hủy lịch", "error");
                    return;
                  }
                  await updateStatus(cancelModal.appointmentId, "cancelled", cancelModal.reason);
                  setCancelModal(null);
                }}
              >
                {updatingStatusId === cancelModal.appointmentId ? "Đang xử lý..." : "Xác nhận hủy"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
