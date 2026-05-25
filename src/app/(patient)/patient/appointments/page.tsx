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
  doctor_name: string | null;
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

function normalizeDate(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function normalizeTime(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 5);
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseCancelInfo(adminNote: string | null): { cancelledBy: string; cancelReason: string } {
  const value = (adminNote || "").trim();
  if (!value) return { cancelledBy: "-", cancelReason: "-" };
  if (value.startsWith("[Benh nhan huy]")) {
    return {
      cancelledBy: "Benh nhan",
      cancelReason: value.replace("[Benh nhan huy]", "").trim() || "-",
    };
  }
  if (value.startsWith("[Bac si huy]")) {
    return {
      cancelledBy: "Bac si",
      cancelReason: value.replace("[Bac si huy]", "").trim() || "-",
    };
  }
  if (value.startsWith("[Admin huy]")) {
    return {
      cancelledBy: "Admin",
      cancelReason: value.replace("[Admin huy]", "").trim() || "-",
    };
  }
  return { cancelledBy: "Khac", cancelReason: value };
}

function statusLabel(status: AppointmentStatus) {
  if (status === "pending" || status === "confirmed") return "Chua kham";
  if (status === "completed") return "Da kham";
  if (status === "no_show") return "Vang mat";
  return "Huy";
}

function statusClass(status: AppointmentStatus) {
  if (status === "pending" || status === "confirmed") return styles.statusPending;
  if (status === "completed") return styles.statusCompleted;
  if (status === "no_show") return styles.statusCancelled;
  return styles.statusCancelled;
}

function formatTimeRange(item: AppointmentItem) {
  const date = normalizeDate(item.work_date) || "-";
  const start = normalizeTime(item.start_time) || "--:--";
  const end = normalizeTime(item.end_time) || "--:--";
  return `${date} (${start} - ${end})`;
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
    const token = getAccessToken();
    const serviceQuery = serviceId ? `&service_id=${serviceId}` : "";
    const result = await apiClient.get<{ data: SlotItem[] }>(
      `/api/public/doctors/${doctorId}/schedule?date=${date}${serviceQuery}`,
      token
    );
    return (result.data || []).filter((slot) => slot.status === "available");
  }

  async function loadAppointments() {
    try {
      setLoading(true);
      const token = getAccessToken();
      const [appointmentsRes, recordsRes] = await Promise.all([
        apiClient.get<{ data: AppointmentItem[] }>("/api/patient/appointments", token),
        apiClient.get<{ data: MedicalRecord[] }>("/api/patient/medical-records", token),
      ]);
      setAppointments(appointmentsRes.data || []);
      const nextMap = new Map<number, MedicalRecord>();
      (recordsRes.data || []).forEach((record) => {
        nextMap.set(record.appointment_id, record);
      });
      setRecordsByAppointmentId(nextMap);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the tai lich hen", "error");
      setAppointments([]);
      setRecordsByAppointmentId(new Map());
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
      alert("Lich hen nay chua gan bac si");
      return;
    }
    const currentDate = normalizeDate(item.work_date);
    if (!currentDate) {
      alert("Khong tim thay ngay kham hien tai");
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
      showToast(err instanceof Error ? err.message : "Khong the tai khung gio doi lich", "error");
    }
  }

  async function submitReschedule() {
    if (!reschedule) return;
    if (!reschedule.selectedSlotId) {
      alert("Vui long chon khung gio moi");
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
      showToast("Doi lich thanh cong", "success");
      setReschedule(null);
      await loadAppointments();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the doi lich", "error");
    } finally {
      setSavingReschedule(false);
    }
  }

  function openRevisit(item: AppointmentItem) {
    if (!item.doctor_id) {
      alert("Lich hen nay chua gan bac si");
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
      alert("Vui long chon khung gio tai kham");
      return;
    }

    setSavingRevisit(true);
    setTimeout(() => {
      alert("Dat tai kham thanh cong (Demo)");
      setRevisit(null);
      setSavingRevisit(false);
    }, 500);
  }

  async function handleCancel(appointmentId: number, reason: string) {
    if (!reason.trim()) {
      showToast("Vui long nhap ly do huy lich", "error");
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
      showToast("Huy lich thanh cong", "success");
      setCancelModal(null);
      await loadAppointments();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the huy lich", "error");
    } finally {
      setSavingCancel(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.card}>
        <h2 className={styles.title}>Danh sach lich kham</h2>

        <div className={styles.filters}>
          <select
            className={styles.control}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">Tat ca trang thai</option>
            <option value="pending_confirmed">Chua kham</option>
            <option value="completed">Da kham</option>
            <option value="no_show">Vang mat</option>
            <option value="cancelled">Huy</option>
          </select>

          <input
            className={styles.control}
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />
        </div>

        {loading ? (
          <p className={styles.empty}>Dang tai lich hen...</p>
        ) : filteredAppointments.length === 0 ? (
          <p className={styles.empty}>
            {hasFilters ? "Khong co lich kham phu hop bo loc." : "Chua co lich kham nao."}
          </p>
        ) : (
          <div className={styles.list}>
            {filteredAppointments.map((item) => {
              const record = recordsByAppointmentId.get(item.id) || null;
              return (
                <article key={item.id} className={styles.item}>
                  <div className={styles.itemTop}>
                    <div>
                      <h3 className={styles.itemTitle}>{item.service_name || "Dich vu kham"}</h3>
                    </div>
                    <span className={`${styles.statusBadge} ${statusClass(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>

                  <div className={styles.metaGrid}>
                    <div>
                      <strong>Lich kham:</strong> {formatTimeRange(item)}
                    </div>
                    <div>
                      <strong>Bac si:</strong> {item.doctor_name || "-"}
                    </div>
                    <div>
                      <strong>Ghi chu dat lich:</strong> {item.note || "-"}
                    </div>
                    <div>
                      <strong>Xu ly phong kham:</strong> {item.admin_note || "-"}
                    </div>
                    {item.status === "cancelled" ? (
                      <>
                        <div>
                          <strong>Ai huy:</strong> {parseCancelInfo(item.admin_note).cancelledBy}
                        </div>
                        <div>
                          <strong>Ly do huy:</strong> {parseCancelInfo(item.admin_note).cancelReason}
                        </div>
                      </>
                    ) : null}
                  </div>

                  {item.status === "completed" ? (
                    <div className={styles.resultBox}>
                      <p className={styles.resultTitle}>Ket qua kham</p>
                      <p>
                        <strong>Chan doan:</strong> {record?.diagnosis || "Chua cap nhat"}
                      </p>
                      <p>
                        <strong>Ghi chu bac si:</strong> {record?.notes || "Chua cap nhat"}
                      </p>
                    </div>
                  ) : null}

                  {(item.status === "pending" || item.status === "confirmed") ? (
                    <div className={styles.actions}>
                      <button className={styles.secondaryBtn} onClick={() => openReschedule(item)}>
                        Doi lich
                      </button>
                      <button
                        className={styles.cancelBtn}
                        onClick={() => setCancelModal({ appointmentId: item.id, reason: "" })}
                      >
                        Huy lich
                      </button>
                    </div>
                  ) : null}

                  {item.status === "completed" ? (
                    <div className={styles.actions}>
                      <button className={styles.secondaryBtn} onClick={() => openRevisit(item)}>
                        Dat tai kham
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
            <h3 className={styles.modalTitle}>Doi lich hen #{reschedule.appointmentId}</h3>
            <input
              className={styles.control}
              type="date"
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
                if (!current || !isValidDateInput(nextDate)) {
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
                    showToast(err instanceof Error ? err.message : "Khong the tai khung gio doi lich", "error");
                  });
              }}
            />

            {reschedule.loadingSlots ? (
              <p className={styles.empty}>Dang tai khung gio...</p>
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
                <option value={0}>Chon khung gio moi</option>
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
              placeholder="Ly do doi lich (khong bat buoc)"
            />

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setReschedule(null)}
                disabled={savingReschedule}
              >
                Huy
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={submitReschedule}
                disabled={savingReschedule}
              >
                {savingReschedule ? "Dang luu..." : "Luu doi lich"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {revisit ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Dat tai kham tu lich #{revisit.appointmentId}</h3>
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
              <p className={styles.empty}>Dang tai khung gio...</p>
            ) : (
              <select
                className={styles.control}
                value={revisit.selectedSlotId}
                onChange={(e) =>
                  setRevisit((prev) => (prev ? { ...prev, selectedSlotId: Number(e.target.value) } : prev))
                }
              >
                <option value={0}>Chon khung gio tai kham</option>
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
              placeholder="Ly do tai kham (khong bat buoc)"
            />

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setRevisit(null)}
                disabled={savingRevisit}
              >
                Huy
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={submitRevisit}
                disabled={savingRevisit}
              >
                {savingRevisit ? "Dang luu..." : "Dat tai kham"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelModal ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Huy lich hen #{cancelModal.appointmentId}</h3>
            <textarea
              className={styles.textArea}
              value={cancelModal.reason}
              onChange={(e) => setCancelModal((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
              placeholder="Nhap ly do huy lich (bat buoc)"
            />

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setCancelModal(null)}
                disabled={savingCancel}
              >
                Dong
              </button>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => handleCancel(cancelModal.appointmentId, cancelModal.reason)}
                disabled={savingCancel}
              >
                {savingCancel ? "Dang huy..." : "Xac nhan huy"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
