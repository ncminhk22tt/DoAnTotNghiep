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
  "Sang",
  "Chieu",
  "Toi",
  "Sang - Chieu",
  "Sang - Toi",
  "Chieu - Toi",
  "Sang - Chieu - Toi",
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Tat ca" },
  { value: "pending_confirmed", label: "Chua kham" },
  { value: "completed", label: "Da kham" },
  { value: "no_show", label: "Vang mat" },
  { value: "cancelled", label: "Huy" },
];

function parseCancelInfo(adminNote: string | null): { cancelledBy: string; cancelReason: string } {
  const value = (adminNote || "").trim();
  if (!value) return { cancelledBy: "-", cancelReason: "-" };
  if (value.startsWith("[Benh nhan huy]")) {
    return { cancelledBy: "Benh nhan", cancelReason: value.replace("[Benh nhan huy]", "").trim() || "-" };
  }
  if (value.startsWith("[Bac si huy]")) {
    return { cancelledBy: "Bac si", cancelReason: value.replace("[Bac si huy]", "").trim() || "-" };
  }
  if (value.startsWith("[Admin huy]")) {
    return { cancelledBy: "Admin", cancelReason: value.replace("[Admin huy]", "").trim() || "-" };
  }
  return { cancelledBy: "Khac", cancelReason: value };
}

function hasCancelInfo(adminNote: string | null): boolean {
  return Boolean(adminNote && adminNote.trim());
}

function statusLabel(status: AppointmentStatus) {
  if (status === "pending" || status === "confirmed") return "Chua kham";
  if (status === "completed") return "Da kham";
  if (status === "no_show") return "Vang mat";
  return "Huy";
}

function formatDateTime(date: string | null, start: string | null, end: string | null) {
  if (!date) return "-";
  const timeRange = start && end ? `${start.slice(0, 5)} - ${end.slice(0, 5)}` : "-";
  return `${date} (${timeRange})`;
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

  const lines = note.split("\n").map((x) => x.trim()).filter(Boolean);
  const readByPrefix = (prefix: string) => {
    const found = lines.find((x) => x.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!found) return null;
    const value = found.slice(prefix.length).trim();
    return value || null;
  };

  return {
    full_name: readByPrefix("Ho va ten:"),
    phone: readByPrefix("So dien thoai:"),
    gender: readByPrefix("Gioi tinh:"),
    birth_year: readByPrefix("Nam sinh:"),
    reason: readByPrefix("Ly do kham:"),
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

  const validItems = normalized.filter(
    (item) => item.medicine_name && item.dosage && item.duration
  );

  return { hasPartialRow, validItems };
}

export default function DoctorAppointmentsPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<AppointmentRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState("");
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
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);
  const [cancelModal, setCancelModal] = useState<{ appointmentId: number; reason: string } | null>(null);

  const loadAppointments = useCallback(async () => {
    try {
      setLoading(true);
      const token = getAccessToken();
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (dateFilter) params.set("date", dateFilter);

      const query = params.toString();
      const res = await apiClient.get<{ data: AppointmentRow[] }>(
        `/api/doctor/appointments${query ? `?${query}` : ""}`,
        token
      );
      setItems(res.data || []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the tai lich hen", "error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFilter, showToast]);

  async function openDetail(appointmentId: number) {
    try {
      setSelectedAppointmentId(appointmentId);
      setDetailLoading(true);
      const token = getAccessToken();
      const res = await apiClient.get<{ data: AppointmentDetail }>(
        `/api/doctor/appointments/${appointmentId}`,
        token
      );
      setDetail(res.data);
      setShowExamForm(false);
      setDiagnosis("");
      setExamNotes("");
      setPrescriptionItems([{ medicine_name: "", dosage: "", duration: "" }]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the tai chi tiet lich hen", "error");
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
      showToast("Vui long nhap chan doan", "error");
      return;
    }
    const { hasPartialRow, validItems: validPrescriptionItems } = validatePrescriptionItems(prescriptionItems);
    if (hasPartialRow) {
      showToast("Thong tin thuoc chua day du. Moi dong can du Ten thuoc, Lieu, Thoi gian dung.", "error");
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

      showToast("Luu ket qua kham thanh cong", "success");
      setShowExamForm(false);
      setDiagnosis("");
      setExamNotes("");
      setPrescriptionItems([{ medicine_name: "", dosage: "", duration: "" }]);
      await loadAppointments();
      await openDetail(selectedAppointmentId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the luu ket qua kham", "error");
    } finally {
      setSubmittingExam(false);
    }
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
      showToast("Cap nhat trang thai thanh cong", "success");
      await loadAppointments();
      if (selectedAppointmentId === appointmentId) {
        await openDetail(appointmentId);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the cap nhat trang thai", "error");
    } finally {
      setUpdatingStatusId(null);
    }
  }

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const detailBookingMeta = useMemo(() => parseBookingMeta(detail?.note || null), [detail?.note]);
  const latestMedicalRecord = useMemo(() => detail?.medical_records?.[0] || null, [detail?.medical_records]);
  const latestPrescriptionItems = useMemo(
    () => latestMedicalRecord?.prescriptions?.[0]?.items || [],
    [latestMedicalRecord]
  );
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
    <div className={styles.page}>
      <h2 className={styles.title}>Lich hen kham benh</h2>

      <section className={styles.filterCard}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Trang thai</label>
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
            <label className={styles.label}>Ngay kham</label>
            <input
              type="date"
              className={styles.input}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>
        </div>
      </section>

      <div className={styles.listContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Benh nhan</th>
              <th className={styles.th}>Dich vu</th>
              <th className={styles.th}>Lich kham</th>
              <th className={styles.th}>Trang thai</th>
              <th className={`${styles.th} ${styles.actionHeader}`}>Thao tac</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={styles.td}>
                  <div>{parseBookingMeta(item.note).full_name || item.patient_name || "-"}</div>
                </td>
                <td className={styles.td}>
                  <div>{item.service_name || "-"}</div>
                </td>
                <td className={styles.td}>
                  <div>{formatDateTime(item.work_date, item.start_time, item.end_time)}</div>
                  <div className={styles.subText}>Phong: {item.room || "-"}</div>
                </td>
                <td className={styles.td}>
                  <span className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`}>
                    {statusLabel(item.status)}
                  </span>
                </td>
                <td className={`${styles.td} ${styles.actionCell}`}>
                  <div className={styles.actionGroup}>
                        <button className={styles.infoBtn} onClick={() => openDetail(item.id)}>
                      {item.status === "pending" || item.status === "confirmed"
                        ? "Chua kham"
                        : item.status === "completed"
                        ? "Da kham"
                        : item.status === "no_show"
                        ? "Vang mat"
                        : "Huy"}
                    </button>
                    {(item.status === "pending" || item.status === "confirmed") ? (
                      <button
                        className={styles.secondaryBtn}
                        disabled={updatingStatusId === item.id}
                        onClick={() => updateStatus(item.id, "no_show")}
                      >
                        Vang mat
                      </button>
                    ) : null}
                    {(item.status === "pending" || item.status === "confirmed") ? (
                      <button
                        className={styles.dangerBtn}
                        disabled={updatingStatusId === item.id}
                        onClick={() => setCancelModal({ appointmentId: item.id, reason: "" })}
                      >
                        Huy
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td className={styles.emptyCell} colSpan={5}>
                  Chua co lich hen nao phu hop bo loc.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedAppointmentId ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Chi tiet lich hen</h3>

            {detailLoading || !detail ? (
              <div className={styles.modalText}>Dang tai chi tiet...</div>
            ) : (
              <>
                {hasStructuredBookingMeta ? (
                  <div className={styles.noteBlock}>
                    <div className={styles.noteTitle}>Thong tin benh nhan luc dat lich</div>
                    <div className={styles.noteContent}>
                      <div><strong>Ho ten:</strong> {detailBookingMeta.full_name || detail.patient_name || "-"}</div>
                      <div><strong>So dien thoai:</strong> {detailBookingMeta.phone || detail.patient_phone || "-"}</div>
                      <div><strong>Gioi tinh:</strong> {detailBookingMeta.gender || "-"}</div>
                      <div><strong>Nam sinh:</strong> {detailBookingMeta.birth_year || "-"}</div>
                    </div>
                  </div>
                ) : null}

                <div className={styles.detailGrid}>
                  {!hasStructuredBookingMeta ? <div><strong>Benh nhan:</strong> {detail.patient_name || "-"}</div> : null}
                  {!hasStructuredBookingMeta ? <div><strong>Dien thoai:</strong> {detail.patient_phone || "-"}</div> : null}
                  <div><strong>Dich vu:</strong> {detail.service_name || "-"}</div>
                  <div><strong>Trang thai:</strong> {statusLabel(detail.status)}</div>
                  <div><strong>Lich kham:</strong> {formatDateTime(detail.work_date, detail.start_time, detail.end_time)}</div>
                  {detail.status === "cancelled" && hasCancelInfo(detail.admin_note) ? (
                    <>
                      <div><strong>Ai huy:</strong> {parseCancelInfo(detail.admin_note).cancelledBy}</div>
                      <div><strong>Ly do huy:</strong> {parseCancelInfo(detail.admin_note).cancelReason}</div>
                    </>
                  ) : null}
                </div>

                <div className={styles.noteBlock}>
                  <div className={styles.noteTitle}>Ly do kham</div>
                  <div className={styles.noteContent}>
                    {detailBookingMeta.reason || (!hasStructuredBookingMeta ? detail.note || "-" : "-")}
                  </div>
                </div>

                {detail.status === "completed" && latestMedicalRecord ? (
                  <div className={styles.noteBlock}>
                    <div className={styles.noteTitle}>Thong tin kham da hoan thanh</div>
                    <div className={styles.noteContent}>
                      <div><strong>Chan doan:</strong> {latestMedicalRecord.diagnosis || "-"}</div>
                      <div><strong>Ghi chu kham:</strong> {latestMedicalRecord.notes || "-"}</div>
                      <div><strong>Danh sach thuoc:</strong></div>
                      {latestPrescriptionItems.length > 0 ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          {latestPrescriptionItems.map((item) => (
                            <div key={item.id}>
                              - {item.medicine_name} | Lieu: {item.dosage} | Thoi gian dung: {item.duration}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div>- Chua ke thuoc.</div>
                      )}
                    </div>
                  </div>
                ) : null}

                {showExamForm ? (
                  <div className={styles.examForm}>
                    <div className={styles.field}>
                      <label className={styles.label}>Ly do kham (tu CSDL)</label>
                      <textarea
                        className={styles.textarea}
                        value={detailBookingMeta.reason || (!hasStructuredBookingMeta ? detail.note || "-" : "-")}
                        readOnly
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Chan doan</label>
                      <textarea
                        className={styles.textarea}
                        value={diagnosis}
                        onChange={(e) => setDiagnosis(e.target.value)}
                        placeholder="Nhap chan doan sau khi kham"
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Ghi chu kham benh</label>
                      <textarea
                        className={styles.textarea}
                        value={examNotes}
                        onChange={(e) => setExamNotes(e.target.value)}
                        placeholder="Nhap ghi chu them (neu co)"
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Ke thuoc</label>
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
                              placeholder="Ten thuoc"
                            />
                            <details className={styles.inlineDropdown}>
                              <summary className={styles.inlineDropdownSummary}>
                                {item.dosage || "Lieu"}
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
                              <option value="">Thoi gian dung</option>
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
                              Xoa
                            </button>
                          </div>
                        ))}
                        <div>
                          <button className={styles.infoBtn} onClick={addPrescriptionItem} type="button">
                            + Them thuoc
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className={styles.modalActions}>
                      <button className={styles.secondaryBtn} onClick={() => setShowExamForm(false)} disabled={submittingExam}>
                        Huy form
                      </button>
                      <button className={styles.primaryBtn} onClick={submitExam} disabled={submittingExam}>
                        {submittingExam ? "Dang luu..." : "Kham benh"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}

            <div className={styles.modalActions}>
              {detail && (detail.status === "pending" || detail.status === "confirmed") ? (
                <button className={styles.primaryBtn} onClick={() => setShowExamForm(true)}>
                  Kham benh
                </button>
              ) : null}
              <button
                className={styles.secondaryBtn}
                onClick={() => {
                  setSelectedAppointmentId(null);
                  setDetail(null);
                  setShowExamForm(false);
                }}
              >
                Dong
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelModal ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard} style={{ width: "min(520px, 95vw)" }}>
            <h3 className={styles.modalTitle}>Huy lich hen #{cancelModal.appointmentId}</h3>
            <textarea
              className={styles.textarea}
              value={cancelModal.reason}
              onChange={(e) =>
                setCancelModal((prev) => (prev ? { ...prev, reason: e.target.value } : prev))
              }
              placeholder="Nhap ly do huy lich"
            />
            <div className={styles.modalActions}>
              <button
                className={styles.secondaryBtn}
                onClick={() => setCancelModal(null)}
                disabled={updatingStatusId === cancelModal.appointmentId}
              >
                Dong
              </button>
              <button
                className={styles.dangerBtn}
                disabled={updatingStatusId === cancelModal.appointmentId}
                onClick={async () => {
                  if (!cancelModal.reason.trim()) {
                    showToast("Vui long nhap ly do huy lich", "error");
                    return;
                  }
                  await updateStatus(cancelModal.appointmentId, "cancelled", cancelModal.reason);
                  setCancelModal(null);
                }}
              >
                {updatingStatusId === cancelModal.appointmentId ? "Dang xu ly..." : "Xac nhan huy"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
