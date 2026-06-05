"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./appointments.module.css";

type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

type StatusFilter = "all" | "pending_confirmed" | "completed" | "no_show" | "cancelled";

type AppointmentItem = {
  id: number;
  slot_id: number | null;
  doctor_id: number | null;
  service_id: number | null;
  status: AppointmentStatus;
  note: string | null;
  admin_note: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  price: number | null;
  doctor_name: string | null;
  doctor_code: string | null;
  doctor_phone: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
  service_name: string | null;
};

type SlotItem = {
  id: number;
  start_time: string | null;
  end_time: string | null;
  status: "available" | "full" | "closed";
};

type MedicalRecord = {
  id: number;
  appointment_id: number;
  diagnosis: string | null;
  notes: string | null;
  created_at: string | null;
};

type MedicalRecordResponseItem = {
  medical_record: MedicalRecord;
};

type BookingMeta = {
  full_name: string | null;
  phone: string | null;
  gender: string | null;
  birth_year: string | null;
  reason: string | null;
};

function normalizeDate(value: string | null): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed);
  }

  return value.slice(0, 10);
}

function formatDisplayDate(value: string | null): string {
  const normalized = normalizeDate(value);
  if (!normalized) return "-";
  const [year, month, day] = normalized.split("-");
  if (!year || !month || !day) return normalized;
  return `${day}-${month}-${year}`;
}

function normalizeTime(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 5);
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getTodayClinicDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isPastClinicDate(value: string): boolean {
  return isValidDateInput(value) && value < getTodayClinicDate();
}

function isPastSlot(date: string, startTime: string | null): boolean {
  const start = normalizeTime(startTime);
  if (!isValidDateInput(date) || !start) return false;
  const slotTime = new Date(`${date}T${start}:00+07:00`);
  if (Number.isNaN(slotTime.getTime())) return false;
  return slotTime.getTime() <= Date.now();
}

function isPastAppointment(item: AppointmentItem): boolean {
  const datePart = normalizeDate(item.work_date);
  const startPart = normalizeTime(item.start_time);
  if (!datePart || !startPart) return false;

  const slotTime = new Date(`${datePart}T${startPart}:00+07:00`);
  if (Number.isNaN(slotTime.getTime())) return false;

  return slotTime.getTime() <= Date.now();
}

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

function parseRescheduleInfo(adminNote: string | null): {
  reason: string;
  fromSchedule: string;
  toSchedule: string;
} | null {
  const value = (adminNote || "").trim();
  if (!value.startsWith("[Yeu cau doi lich]")) return null;

  const payload = value.replace("[Yeu cau doi lich]", "").trim();
  const [left, right] = payload.split("->").map((x) => x?.trim() || "");
  const [reasonPart, fromPart] = left.split("|").map((x) => x?.trim() || "");

  const formatSchedulePart = (raw: string): string => {
    if (!raw) return "-";
    const timeMatch = raw.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
    const start = timeMatch?.[1] || "--:--";
    const end = timeMatch?.[2] || "--:--";

    const dateText = raw.replace(/\s*\d{2}:\d{2}-\d{2}:\d{2}.*/, "").trim();
    const normalizedDateText = dateText.replace(/\s*\(.*\)\s*/g, " ").trim();
    const parsedDate = new Date(normalizedDateText);
    const yyyyMmDd =
      Number.isNaN(parsedDate.getTime())
        ? "-"
        : new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Ho_Chi_Minh",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(parsedDate);

    return `${formatDisplayDate(yyyyMmDd)} (${start} - ${end})`;
  };

  return {
    reason: reasonPart || "-",
    fromSchedule: formatSchedulePart(fromPart),
    toSchedule: formatSchedulePart(right),
  };
}

function hasRescheduled(adminNote: string | null): boolean {
  return Boolean(parseRescheduleInfo(adminNote));
}

function statusLabel(status: AppointmentStatus) {
  if (status === "pending" || status === "confirmed") return "Chưa khám";
  if (status === "completed") return "Đã khám";
  if (status === "no_show") return "Vắng mặt";
  return "Hủy";
}

function statusClass(status: AppointmentStatus) {
  if (status === "pending" || status === "confirmed") return styles.statusPending;
  if (status === "completed") return styles.statusCompleted;
  if (status === "no_show") return styles.statusCancelled;
  return styles.statusCancelled;
}

function formatTimeRange(item: AppointmentItem) {
  const date = formatDisplayDate(item.work_date);
  const start = normalizeTime(item.start_time) || "--:--";
  const end = normalizeTime(item.end_time) || "--:--";
  return `${date} (${start} - ${end})`;
}

function formatBookingNote(note: string | null): string {
  if (!note) return "-";
  return note
    .replace(/\[Thong tin dat lich\]\s*\n?/gi, "")
    .replace(/Ho va ten:/gi, "Họ và tên:")
    .replace(/So dien thoai:/gi, "Số điện thoại:")
    .replace(/Gioi tinh:/gi, "Giới tính:")
    .replace(/Nam sinh:/gi, "Năm sinh:")
    .replace(/Ly do kham:/gi, "Lý do khám:");
}

function normalizeGenderLabel(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["nu", "nữ", "female", "f"].includes(normalized)) return "Nữ";
  if (["nam", "male", "m"].includes(normalized)) return "Nam";
  return value.trim();
}

function parseBookingMeta(note: string | null): BookingMeta {
  const empty: BookingMeta = {
    full_name: null,
    phone: null,
    gender: null,
    birth_year: null,
    reason: null,
  };
  const text = formatBookingNote(note);
  if (!text || text === "-") return empty;

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const read = (prefix: string) => {
    const found = lines.find((line) => line.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!found) return null;
    const value = found.slice(prefix.length).trim();
    return value || null;
  };

  return {
    full_name: read("Họ và tên:"),
    phone: read("Số điện thoại:"),
    gender: normalizeGenderLabel(read("Giới tính:")),
    birth_year: read("Năm sinh:"),
    reason: read("Lý do khám:"),
  };
}

function getDefaultRevisitDate() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  const yyyy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function PatientAppointmentsPage() {
  const { showToast } = useToast();
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [recordsByAppointmentId, setRecordsByAppointmentId] = useState<Map<number, MedicalRecord>>(new Map());

  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState("");
  const [reschedule, setReschedule] = useState<{
    appointmentId: number;
    doctorId: number;
    serviceId: number | null;
    date: string;
    reason: string;
    slots: SlotItem[];
    selectedSlotId: number;
    loadingSlots: boolean;
  } | null>(null);
  const [savingReschedule, setSavingReschedule] = useState(false);
  const [revisit, setRevisit] = useState<{
    appointmentId: number;
    doctorId: number;
    serviceId: number | null;
    date: string;
    reason: string;
    slots: SlotItem[];
    selectedSlotId: number;
    loadingSlots: boolean;
  } | null>(null);
  const [savingRevisit, setSavingRevisit] = useState(false);
  const [cancelModal, setCancelModal] = useState<{ appointmentId: number; reason: string } | null>(null);
  const [savingCancel, setSavingCancel] = useState(false);

  async function loadRescheduleSlots(
    doctorId: number,
    date: string,
    serviceId: number | null
  ): Promise<SlotItem[]> {
    if (!isValidDateInput(date)) return [];
    if (isPastClinicDate(date)) return [];
    const token = getAccessToken();
    const serviceQuery = serviceId ? `&service_id=${serviceId}` : "";
    const result = await apiClient.get<{ data: SlotItem[] }>(
      `/api/public/doctors/${doctorId}/schedule?date=${date}${serviceQuery}`,
      token
    );
    return (result.data || []).filter(
      (slot) => slot.status === "available" && !isPastSlot(date, slot.start_time)
    );
  }

  async function loadAppointments() {
    let hasAppointmentsError = false;
    try {
      setLoading(true);
      const token = getAccessToken();
      const [appointmentsResult, recordsResult] = await Promise.allSettled([
        apiClient.get<{ data: AppointmentItem[] }>("/api/patient/appointments", token),
        apiClient.get<{ data: MedicalRecordResponseItem[] }>("/api/patient/medical-records", token),
      ]);

      if (appointmentsResult.status === "fulfilled") {
        setAppointments(appointmentsResult.value.data || []);
      } else {
        hasAppointmentsError = true;
        setAppointments([]);
        const message =
          appointmentsResult.reason instanceof Error
            ? appointmentsResult.reason.message
            : "Không thể tải lịch hẹn";
        showToast(message, "error");
      }

      if (recordsResult.status === "fulfilled") {
        const nextMap = new Map<number, MedicalRecord>();
        (recordsResult.value.data || []).forEach((record) => {
          nextMap.set(record.medical_record.appointment_id, record.medical_record);
        });
        setRecordsByAppointmentId(nextMap);
      } else {
        setRecordsByAppointmentId(new Map());
        if (!hasAppointmentsError) {
          showToast("Không thể tải hồ sơ bệnh án, vẫn hiển thị lịch hẹn.", "info");
        }
      }
    } catch {
      setAppointments([]);
      setRecordsByAppointmentId(new Map());
      showToast("Không thể tải lịch hẹn", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAppointments();
  }, []);

  const filteredAppointments = useMemo(() => {
    return appointments.filter((item) => {
      if (statusFilter !== "all") {
        if (statusFilter === "pending_confirmed" && item.status !== "pending" && item.status !== "confirmed") return false;
        if (statusFilter === "completed" && item.status !== "completed") return false;
        if (statusFilter === "no_show" && item.status !== "no_show") return false;
        if (statusFilter === "cancelled" && item.status !== "cancelled") return false;
      }
      if (dateFilter && normalizeDate(item.work_date) !== dateFilter) return false;
      return true;
    });
  }, [appointments, statusFilter, dateFilter]);

  const hasFilters = useMemo(() => statusFilter !== "all" || Boolean(dateFilter), [statusFilter, dateFilter]);

  async function openReschedule(item: AppointmentItem) {
    if (!item.doctor_id) {
      alert("Lịch hẹn này chưa gán bác sĩ");
      return;
    }
    const currentDate = normalizeDate(item.work_date);
    if (!currentDate) {
      alert("Không tìm thấy ngày khám hiện tại");
      return;
    }

    setReschedule({
      appointmentId: item.id,
      doctorId: item.doctor_id,
      serviceId: item.service_id || null,
      date: currentDate,
      reason: "",
      slots: [],
      selectedSlotId: 0,
      loadingSlots: true,
    });

    try {
      const slots = await loadRescheduleSlots(item.doctor_id, currentDate, item.service_id || null);
      setReschedule((prev) =>
        prev
          ? {
              ...prev,
              slots,
              selectedSlotId: slots[0]?.id || 0,
              loadingSlots: false,
            }
          : prev
      );
    } catch (err) {
      setReschedule((prev) => (prev ? { ...prev, slots: [], selectedSlotId: 0, loadingSlots: false } : prev));
      showToast(err instanceof Error ? err.message : "Không thể tải khung giờ đổi lịch", "error");
    }
  }

  async function submitReschedule() {
    if (!reschedule) return;
    if (!reschedule.selectedSlotId) {
      alert("Vui lòng chọn khung giờ mới");
      return;
    }
    try {
      setSavingReschedule(true);
      const token = getAccessToken();
      await apiClient.patch(
        `/api/patient/appointments/${reschedule.appointmentId}/reschedule`,
        {
          new_slot_id: reschedule.selectedSlotId,
          reason: reschedule.reason.trim() || undefined,
        },
        token
      );
      showToast("Đổi lịch thành công", "success");
      setReschedule(null);
      await loadAppointments();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể đổi lịch", "error");
    } finally {
      setSavingReschedule(false);
    }
  }

  function openRevisit(item: AppointmentItem) {
    if (!item.doctor_id) {
      alert("Lịch hẹn này chưa gán bác sĩ");
      return;
    }

    const defaultDate = getDefaultRevisitDate();
    const demoSlots: SlotItem[] = [
      { id: 201, start_time: "08:00:00", end_time: "08:30:00", status: "available" },
      { id: 202, start_time: "09:30:00", end_time: "10:00:00", status: "available" },
      { id: 203, start_time: "10:00:00", end_time: "10:30:00", status: "available" },
      { id: 204, start_time: "15:00:00", end_time: "15:30:00", status: "available" },
    ];

    setRevisit({
      appointmentId: item.id,
      doctorId: item.doctor_id,
      serviceId: item.service_id || null,
      date: defaultDate,
      reason: "",
      slots: demoSlots,
      selectedSlotId: demoSlots[0]?.id || 0,
      loadingSlots: false,
    });
  }

  function submitRevisit() {
    if (!revisit) return;
    if (!revisit.selectedSlotId) {
      alert("Vui lòng chọn khung giờ tái khám");
      return;
    }

    setSavingRevisit(true);
    setTimeout(() => {
      alert("Đặt tái khám thành công (Demo)");
      setRevisit(null);
      setSavingRevisit(false);
    }, 500);
  }

  async function handleCancel(appointmentId: number, reason: string) {
    if (!reason.trim()) {
      showToast("Vui lòng nhập lý do hủy lịch", "error");
      return;
    }

    try {
      setSavingCancel(true);
      const token = getAccessToken();
      await apiClient.patch(
        "/api/patient/appointments",
        { appointment_id: appointmentId, cancel_reason: reason.trim() },
        token
      );
      showToast("Hủy lịch thành công", "success");
      setCancelModal(null);
      await loadAppointments();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể hủy lịch", "error");
    } finally {
      setSavingCancel(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <h2 className={styles.title}>Danh sách lịch khám</h2>

        <div className={styles.filters}>
          <select
            className={styles.control}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="pending_confirmed">Chưa khám</option>
            <option value="completed">Đã khám</option>
            <option value="no_show">Vắng mặt</option>
            <option value="cancelled">Hủy</option>
          </select>

          <input
            className={styles.control}
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>

        {loading ? (
          <p className={styles.empty}>Đang tải lịch hẹn...</p>
        ) : filteredAppointments.length === 0 ? (
          <p className={styles.empty}>
            {hasFilters ? "Không có lịch khám phù hợp bộ lọc." : "Chưa có lịch khám nào."}
          </p>
        ) : (
          <div className={styles.list}>
            {filteredAppointments.map((item) => {
              const record = recordsByAppointmentId.get(item.id) || null;
              const bookingMeta = parseBookingMeta(item.note);
              const canCancelPendingAppointment =
                (item.status === "pending" || item.status === "confirmed") && !isPastAppointment(item);
              const canRescheduleAppointment =
                canCancelPendingAppointment && !hasRescheduled(item.admin_note);
              return (
                <article key={item.id} className={styles.item}>
                  <div className={styles.itemTop}>
                    <div>
                      <h3 className={styles.itemTitle}>{item.service_name || "Dịch vụ khám"}</h3>
                    </div>
                    <span className={`${styles.statusBadge} ${statusClass(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>

                  <div className={styles.infoSplit}>
                    <div className={styles.infoBoxUser}>
                      <div className={styles.infoBoxTitle}>Thông tin người dùng</div>
                      <div className={styles.headerLine}>
                        <strong>Họ tên:</strong> {bookingMeta.full_name || "-"}
                      </div>
                      <div className={styles.headerLine}>
                        <strong>Số điện thoại:</strong> {bookingMeta.phone || "-"}
                      </div>
                      <div className={styles.headerLine}>
                        <strong>Giới tính:</strong> {bookingMeta.gender || "-"}
                      </div>
                      <div className={styles.headerLine}>
                        <strong>Năm sinh:</strong> {bookingMeta.birth_year || "-"}
                      </div>
                      <div className={styles.headerLine}>
                        <strong>Lý do khám:</strong> {bookingMeta.reason || "-"}
                      </div>
                    </div>

                    <div className={styles.infoBoxDoctor}>
                      <div className={styles.infoBoxTitle}>Thông tin bác sĩ</div>
                      <div className={styles.headerLine}>
                        <strong>Bác sĩ:</strong> {item.doctor_name || "-"}
                      </div>
                      <div className={styles.headerLine}>
                        <strong>Mã bác sĩ:</strong> {item.doctor_code || "-"}
                      </div>
                      <div className={styles.headerLine}>
                        <strong>Số điện thoại:</strong> {item.doctor_phone || "-"}
                      </div>
                      <div className={styles.headerLine}>
                        <strong>Khoa:</strong> {item.specialty_name || "-"}
                      </div>
                      <div className={styles.headerLine}>
                        <strong>Dịch vụ:</strong> {item.service_name || "-"}
                      </div>
                      <div className={styles.headerLine}>
                        <strong>Phòng:</strong> {item.room || "-"}
                      </div>
                    </div>
                  </div>

                  <div className={styles.metaGrid}>
                    <div>
                      <strong>Lịch khám:</strong> {formatTimeRange(item)}
                    </div>
                    <div>
                      <strong>Giá tiền:</strong> {Number(item.price || 0).toLocaleString("vi-VN")} đ
                    </div>
                    {item.status === "cancelled" ? (
                      <div>
                        <strong>Xử lý:</strong>
                        <div>Bên hủy: {parseCancelInfo(item.admin_note).cancelledBy}</div>
                        <div>Lý do hủy: {parseCancelInfo(item.admin_note).cancelReason}</div>
                      </div>
                    ) : parseRescheduleInfo(item.admin_note) ? (
                      <div>
                        <strong>Xử lý:</strong>
                        <div>Lý do đổi lịch: {parseRescheduleInfo(item.admin_note)?.reason}</div>
                        <div>Lịch trước đổi: {parseRescheduleInfo(item.admin_note)?.fromSchedule}</div>
                        <div>Lịch sau đổi: {parseRescheduleInfo(item.admin_note)?.toSchedule}</div>
                      </div>
                    ) : (
                      <div>
                        <strong>Xử lý:</strong> {item.admin_note || "-"}
                      </div>
                    )}
                  </div>

                  {item.status === "completed" ? (
                    <div className={styles.resultBox}>
                      <p className={styles.resultTitle}>Kết quả khám</p>
                      <p>
                        <strong>Chẩn đoán:</strong> {record?.diagnosis || "Chưa cập nhật"}
                      </p>
                      <p>
                        <strong>Ghi chú bác sĩ:</strong> {record?.notes || "Chưa cập nhật"}
                      </p>
                    </div>
                  ) : null}

                  {canCancelPendingAppointment ? (
                    <div className={styles.actions}>
                      {canRescheduleAppointment ? (
                        <button className={styles.secondaryBtn} onClick={() => openReschedule(item)}>
                          Đổi lịch
                        </button>
                      ) : null}
                      <button
                        className={styles.cancelBtn}
                        onClick={() => setCancelModal({ appointmentId: item.id, reason: "" })}
                      >
                        Hủy lịch
                      </button>
                    </div>
                  ) : null}

                  {item.status === "completed" ? (
                    <div className={styles.actions}>
                      <button className={styles.secondaryBtn} onClick={() => openRevisit(item)}>
                        Đặt tái khám
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {reschedule ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Đổi lịch hẹn</h3>
            <input
              className={styles.control}
              type="date"
              min={getTodayClinicDate()}
              value={reschedule.date}
              onChange={(e) => {
                const nextDate = e.target.value;
                setReschedule((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    date: nextDate,
                    slots: [],
                    selectedSlotId: 0,
                    loadingSlots: true,
                  };
                });

                const current = reschedule;
                if (!current || !isValidDateInput(nextDate) || isPastClinicDate(nextDate)) {
                  setReschedule((prev) => (prev ? { ...prev, loadingSlots: false } : prev));
                  return;
                }

                loadRescheduleSlots(current.doctorId, nextDate, current.serviceId)
                  .then((slots) => {
                    setReschedule((prev) =>
                      prev
                        ? {
                            ...prev,
                            slots,
                            selectedSlotId: slots[0]?.id || 0,
                            loadingSlots: false,
                          }
                        : prev
                    );
                  })
                  .catch((err) => {
                    setReschedule((prev) => (prev ? { ...prev, slots: [], selectedSlotId: 0, loadingSlots: false } : prev));
                    showToast(err instanceof Error ? err.message : "Không thể tải khung giờ đổi lịch", "error");
                  });
              }}
            />

            {reschedule.loadingSlots ? (
              <p className={styles.empty}>Đang tải khung giờ...</p>
            ) : reschedule.slots.length === 0 ? (
              <p className={styles.empty}>Không có khung giờ hợp lệ để đổi lịch.</p>
            ) : (
              <select
                className={styles.control}
                value={reschedule.selectedSlotId}
                onChange={(e) =>
                  setReschedule((prev) =>
                    prev ? { ...prev, selectedSlotId: Number(e.target.value) } : prev
                  )
                }
              >
                <option value={0}>Chọn khung giờ mới</option>
                {reschedule.slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {normalizeTime(slot.start_time) || "--:--"} - {normalizeTime(slot.end_time) || "--:--"}
                  </option>
                ))}
              </select>
            )}

            <textarea
              className={styles.textArea}
              value={reschedule.reason}
              onChange={(e) =>
                setReschedule((prev) => (prev ? { ...prev, reason: e.target.value } : prev))
              }
              placeholder="Lý do đổi lịch (không bắt buộc)"
            />

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setReschedule(null)}
                disabled={savingReschedule}
              >
                Hủy
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={submitReschedule}
                disabled={savingReschedule}
              >
                {savingReschedule ? "Đang lưu..." : "Lưu đổi lịch"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {revisit ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Đặt tái khám từ lịch #{revisit.appointmentId}</h3>
            <input
              className={styles.control}
              type="date"
              value={revisit.date}
              onChange={(e) => {
                const nextDate = e.target.value;
                setRevisit((prev) =>
                  prev ? { ...prev, date: nextDate } : prev
                );
              }}
            />

            {revisit.loadingSlots ? (
              <p className={styles.empty}>Đang tải khung giờ...</p>
            ) : (
              <select
                className={styles.control}
                value={revisit.selectedSlotId}
                onChange={(e) =>
                  setRevisit((prev) => (prev ? { ...prev, selectedSlotId: Number(e.target.value) } : prev))
                }
              >
                <option value={0}>Chọn khung giờ tái khám</option>
                {revisit.slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {normalizeTime(slot.start_time) || "--:--"} - {normalizeTime(slot.end_time) || "--:--"}
                  </option>
                ))}
              </select>
            )}

            <textarea
              className={styles.textArea}
              value={revisit.reason}
              onChange={(e) => setRevisit((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
              placeholder="Lý do tái khám (không bắt buộc)"
            />

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setRevisit(null)}
                disabled={savingRevisit}
              >
                Hủy
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={submitRevisit}
                disabled={savingRevisit}
              >
                {savingRevisit ? "Đang lưu..." : "Đặt tái khám"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelModal ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Hủy lịch hẹn</h3>
            <textarea
              className={styles.textArea}
              value={cancelModal.reason}
              onChange={(e) => setCancelModal((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
              placeholder="Nhập lý do hủy lịch (bắt buộc)"
            />

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setCancelModal(null)}
                disabled={savingCancel}
              >
                Đóng
              </button>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => handleCancel(cancelModal.appointmentId, cancelModal.reason)}
                disabled={savingCancel}
              >
                {savingCancel ? "Đang hủy..." : "Xác nhận hủy"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
