"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken, getAuthUser } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./medical-records.module.css";

type MedicalRecordRow = {
  id: number;
  appointment_id: number;
  diagnosis: string | null;
  notes: string | null;
  created_at: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  patient_email: string | null;
  appointment_note: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  room: string | null;
  service_name: string | null;
  status: "pending" | "confirmed" | "completed" | "cancelled" | null;
};

type PrescriptionItem = {
  id?: number;
  medicine_name: string;
  dosage: string;
  duration: string;
};

type Prescription = {
  id: number;
  medical_record_id: number;
  items: PrescriptionItem[];
};

type RevisionRow = {
  id: number;
  diagnosis: string | null;
  notes: string | null;
  created_at: string;
  prescription_items: PrescriptionItem[];
};

type BookingMeta = {
  full_name: string | null;
  phone: string | null;
  gender: string | null;
  birth_year: string | null;
  reason: string | null;
};

type EditablePrescriptionInput = {
  medicine_name: string;
  dosage: string;
  duration: string;
};

type NormalizedPrescriptionItem = {
  medicine_name: string;
  dosage: string;
  duration: string;
};

type ViewVersion = {
  key: string;
  label: string;
  diagnosis: string | null;
  notes: string | null;
  prescriptionItems: PrescriptionItem[];
  isCurrent: boolean;
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

function statusLabel(status: MedicalRecordRow["status"]) {
  if (status === "pending") return "Cho xac nhan";
  if (status === "confirmed") return "Da xac nhan";
  if (status === "completed") return "Da hoan tat";
  if (status === "cancelled") return "Da huy";
  return "-";
}

function formatSchedule(row: MedicalRecordRow) {
  if (!row.work_date) return "-";
  const start = row.start_time ? row.start_time.slice(0, 5) : "--:--";
  const end = row.end_time ? row.end_time.slice(0, 5) : "--:--";
  return `${row.work_date} (${start} - ${end})`;
}

function formatRevisionLabel(createdAt: string, idx: number) {
  const date = new Date(createdAt);
  const d = Number.isNaN(date.getTime()) ? createdAt : date.toLocaleString("vi-VN");
  return `Lan sua ${idx + 1} - ${d}`;
}

function validatePrescriptionItems(items: EditablePrescriptionInput[]) {
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

export default function DoctorMedicalRecordsPage() {
  const { showToast } = useToast();
  const [records, setRecords] = useState<MedicalRecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);
  const [serviceFilter, setServiceFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loadingPrescriptions, setLoadingPrescriptions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDiagnosis, setEditDiagnosis] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPrescriptionItems, setEditPrescriptionItems] = useState<EditablePrescriptionInput[]>([
    { medicine_name: "", dosage: "", duration: "" },
  ]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingRecord, setDeletingRecord] = useState(false);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [selectedVersionKey, setSelectedVersionKey] = useState("current");

  async function loadRecords() {
    try {
      setLoading(true);
      const token = getAccessToken();
      const res = await apiClient.get<{ data: MedicalRecordRow[] }>("/api/doctor/medical-records", token);
      const data = res.data || [];
      setRecords(data);
      if (data.length > 0) {
        setSelectedRecordId((prev) => prev ?? data[0].id);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the tai thong tin kham", "error");
    } finally {
      setLoading(false);
    }
  }

  async function loadPrescriptions(medicalRecordId: number) {
    try {
      setLoadingPrescriptions(true);
      const token = getAccessToken();
      const res = await apiClient.get<{ data: Prescription[] }>(
        `/api/doctor/medical-records/${medicalRecordId}/prescriptions`,
        token
      );
      setPrescriptions(res.data || []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the tai don thuoc", "error");
    } finally {
      setLoadingPrescriptions(false);
    }
  }

  async function loadRevisions(medicalRecordId: number) {
    try {
      setLoadingRevisions(true);
      const token = getAccessToken();
      const res = await apiClient.get<{ data: RevisionRow[] }>(
        `/api/doctor/medical-records/${medicalRecordId}/revisions`,
        token
      );
      setRevisions(res.data || []);
    } catch {
      setRevisions([]);
    } finally {
      setLoadingRevisions(false);
    }
  }

  useEffect(() => {
    loadRecords();
  }, []);

  useEffect(() => {
    if (!selectedRecordId) return;
    loadPrescriptions(selectedRecordId);
    loadRevisions(selectedRecordId);
    setSelectedVersionKey("current");
  }, [selectedRecordId]);

  const serviceOptions = useMemo(() => {
    const names = Array.from(new Set(records.map((r) => (r.service_name || "").trim()).values())).filter(Boolean);
    return names.sort((a, b) => a.localeCompare(b));
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const serviceOk = serviceFilter === "all" || (r.service_name || "").trim() === serviceFilter;
      const dateOk = !dateFilter || (r.work_date || "").slice(0, 10) === dateFilter;
      return serviceOk && dateOk;
    });
  }, [records, serviceFilter, dateFilter]);

  const selectedRecord = useMemo(
    () => filteredRecords.find((r) => r.id === selectedRecordId) || null,
    [filteredRecords, selectedRecordId]
  );
  const bookingMeta = useMemo(
    () => parseBookingMeta(selectedRecord?.appointment_note || null),
    [selectedRecord?.appointment_note]
  );
  const currentPrescriptionItems = useMemo(() => prescriptions.flatMap((p) => p.items || []), [prescriptions]);

  const versions = useMemo<ViewVersion[]>(() => {
    const current: ViewVersion = {
      key: "current",
      label: "Ket qua hien tai",
      diagnosis: selectedRecord?.diagnosis || null,
      notes: selectedRecord?.notes || null,
      prescriptionItems: currentPrescriptionItems,
      isCurrent: true,
    };

    const history = revisions.map((rev, idx) => ({
      key: `rev-${rev.id}`,
      label: formatRevisionLabel(rev.created_at, idx),
      diagnosis: rev.diagnosis,
      notes: rev.notes,
      prescriptionItems: rev.prescription_items || [],
      isCurrent: false,
    }));
    return [current, ...history];
  }, [selectedRecord?.diagnosis, selectedRecord?.notes, currentPrescriptionItems, revisions]);

  const selectedVersion = useMemo(
    () => versions.find((v) => v.key === selectedVersionKey) || versions[0] || null,
    [versions, selectedVersionKey]
  );

  useEffect(() => {
    if (filteredRecords.length === 0) {
      setSelectedRecordId(null);
      return;
    }
    setSelectedRecordId((prev) => {
      if (prev && filteredRecords.some((r) => r.id === prev)) return prev;
      return filteredRecords[0].id;
    });
  }, [filteredRecords]);

  useEffect(() => {
    if (!selectedRecord) {
      setIsEditing(false);
      setEditDiagnosis("");
      setEditNotes("");
      setEditPrescriptionItems([{ medicine_name: "", dosage: "", duration: "" }]);
      return;
    }
    if (isEditing) return;
    setEditDiagnosis(selectedRecord.diagnosis || "");
    setEditNotes(selectedRecord.notes || "");
    const firstPrescription = prescriptions[0];
    if (firstPrescription && firstPrescription.items.length > 0) {
      setEditPrescriptionItems(
        firstPrescription.items.map((item) => ({
          medicine_name: item.medicine_name || "",
          dosage: item.dosage || "",
          duration: item.duration || "",
        }))
      );
    } else {
      setEditPrescriptionItems([{ medicine_name: "", dosage: "", duration: "" }]);
    }
  }, [selectedRecord, isEditing, prescriptions]);

  function updateEditPrescriptionItem(index: number, field: keyof EditablePrescriptionInput, value: string) {
    setEditPrescriptionItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  function addEditPrescriptionItem() {
    setEditPrescriptionItems((prev) => [...prev, { medicine_name: "", dosage: "", duration: "" }]);
  }

  function removeEditPrescriptionItem(index: number) {
    setEditPrescriptionItems((prev) => {
      if (prev.length <= 1) return [{ medicine_name: "", dosage: "", duration: "" }];
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSaveEdit() {
    if (!selectedRecord) return;
    if (!editDiagnosis.trim()) {
      showToast("Chan doan khong duoc de trong", "error");
      return;
    }
    const { hasPartialRow, validItems: validPrescriptionItems } = validatePrescriptionItems(editPrescriptionItems);
    if (hasPartialRow) {
      showToast("Thong tin thuoc chua day du. Moi dong can du Ten thuoc, Lieu, Thoi gian dung.", "error");
      return;
    }
    if (validPrescriptionItems.length === 0) {
      showToast("Don thuoc phai co it nhat 1 thuoc hop le", "error");
      return;
    }

    try {
      setSavingEdit(true);
      const token = getAccessToken();
      await apiClient.patch<{ success: boolean; message?: string }>(
        `/api/doctor/medical-records/${selectedRecord.id}`,
        { diagnosis: editDiagnosis.trim(), notes: editNotes.trim() },
        token
      );

      const targetPrescriptionId = prescriptions[0]?.id;
      if (targetPrescriptionId) {
        await apiClient.patch<{ success: boolean; message?: string }>(
          `/api/doctor/prescriptions/${targetPrescriptionId}`,
          { items: validPrescriptionItems },
          token
        );
      } else {
        await apiClient.post<{ success: boolean; message?: string }>(
          `/api/doctor/medical-records/${selectedRecord.id}/prescriptions`,
          { items: validPrescriptionItems },
          token
        );
      }

      showToast("Da cap nhat ket qua kham va don thuoc", "success");
      setIsEditing(false);
      setSelectedVersionKey("current");
      await loadRecords();
      await loadPrescriptions(selectedRecord.id);
      await loadRevisions(selectedRecord.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the cap nhat ket qua kham", "error");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeleteRecord() {
    if (!selectedRecord) return;
    try {
      setDeletingRecord(true);
      const token = getAccessToken();
      await apiClient.delete<{ success: boolean; message?: string }>(
        `/api/doctor/medical-records/${selectedRecord.id}`,
        token
      );
      showToast("Da xoa ket qua kham", "success");
      setShowDeleteConfirm(false);
      setIsEditing(false);
      setSelectedVersionKey("current");
      setPrescriptions([]);
      setRevisions([]);
      await loadRecords();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the xoa ket qua kham", "error");
    } finally {
      setDeletingRecord(false);
    }
  }

  const canChangeRecord = !isEditing && !savingEdit;
  const viewingCurrentVersion = selectedVersion?.isCurrent ?? true;

  function printCurrentRecord() {
    if (!selectedRecord || !selectedVersion) return;
    const doctorUser = getAuthUser("doctor");
    const medicines = (selectedVersion.prescriptionItems || [])
      .map(
        (item, index) =>
          `<tr>
            <td style=\"padding:6px 8px;border:1px solid #ddd;\">${index + 1}</td>
            <td style=\"padding:6px 8px;border:1px solid #ddd;\">${escapeHtml(item.medicine_name || "-")}</td>
            <td style=\"padding:6px 8px;border:1px solid #ddd;\">${escapeHtml(item.dosage || "-")}</td>
            <td style=\"padding:6px 8px;border:1px solid #ddd;\">${escapeHtml(item.duration || "-")}</td>
          </tr>`
      )
      .join("");

    const html = `<!doctype html>
<html lang=\"vi\">
<head>
  <meta charset=\"utf-8\" />
  <title>Phieu kham #${selectedRecord.id}</title>
</head>
<body style=\"font-family:Arial,sans-serif;padding:20px;color:#111;\">
  <h2 style=\"margin:0 0 10px;\">Phiếu khám bệnh</h2>
  <div style=\"margin-bottom:14px;\">
    <div><strong>Mã hồ sơ:</strong> #${selectedRecord.id}</div>
    <div><strong>Bác sĩ:</strong> ${escapeHtml(doctorUser?.full_name || "-")}</div>
    <div><strong>Dịch vụ:</strong> ${escapeHtml(selectedRecord.service_name || "-")}</div>
    <div><strong>Lịch khám:</strong> ${escapeHtml(formatSchedule(selectedRecord))}</div>
    <div><strong>Phòng:</strong> ${escapeHtml(selectedRecord.room || "-")}</div>
  </div>

  <h3 style=\"margin:0 0 8px;\">Thông tin bệnh nhân</h3>
  <div style=\"margin-bottom:14px;\">
    <div><strong>Họ tên:</strong> ${escapeHtml(bookingMeta.full_name || selectedRecord.patient_name || "-")}</div>
    <div><strong>Số điện thoại:</strong> ${escapeHtml(bookingMeta.phone || selectedRecord.patient_phone || "-")}</div>
    <div><strong>Giới tính:</strong> ${escapeHtml(bookingMeta.gender || "-")}</div>
    <div><strong>Năm sinh:</strong> ${escapeHtml(bookingMeta.birth_year || "-")}</div>
  </div>

  <h3 style=\"margin:0 0 8px;\">Kết quả khám</h3>
  <div style=\"margin-bottom:14px;\">
    <div><strong>Lý do khám:</strong> ${escapeHtml(bookingMeta.reason || "-")}</div>
    <div><strong>Chẩn đoán:</strong> ${escapeHtml(selectedVersion.diagnosis || "-")}</div>
    <div><strong>Ghi chú khám:</strong> ${escapeHtml(selectedVersion.notes || "-")}</div>
  </div>

  <h3 style=\"margin:0 0 8px;\">Đơn thuốc</h3>
  <table style=\"border-collapse:collapse;width:100%;\">
    <thead>
      <tr>
        <th style=\"padding:6px 8px;border:1px solid #ddd;text-align:left;\">#</th>
        <th style=\"padding:6px 8px;border:1px solid #ddd;text-align:left;\">Tên thuốc</th>
        <th style=\"padding:6px 8px;border:1px solid #ddd;text-align:left;\">Liều</th>
        <th style=\"padding:6px 8px;border:1px solid #ddd;text-align:left;\">Thời gian dùng</th>
      </tr>
    </thead>
    <tbody>
      ${medicines || `<tr><td colspan=\"4\" style=\"padding:8px;border:1px solid #ddd;\">Chưa kê thuốc</td></tr>`}
    </tbody>
  </table>
</body>
</html>`;

    const printWindow = window.open("", "_blank", "width=1000,height=760");
    if (!printWindow) {
      showToast("Trình duyệt đang chặn popup in.", "error");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Thong tin kham benh</h2>

      <div className={styles.layout}>
        <section className={styles.leftCard}>
          <h3 className={styles.subTitle}>Danh sach ho so da kham</h3>
          <div className={styles.filterRow}>
            <label className={styles.filterLabel}>Chon dich vu</label>
            <select
              className={styles.filterSelect}
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              disabled={!canChangeRecord}
            >
              <option value="all">Tat ca dich vu</option>
              {serviceOptions.map((serviceName) => (
                <option key={serviceName} value={serviceName}>
                  {serviceName}
                </option>
              ))}
            </select>
            <label className={styles.filterLabel}>Chon ngay</label>
            <input
              type="date"
              className={styles.filterSelect}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              disabled={!canChangeRecord}
            />
          </div>
          <div className={styles.listWrap}>
            {filteredRecords.map((r) => (
              <button
                key={r.id}
                className={`${styles.listItem} ${selectedRecordId === r.id ? styles.listItemActive : ""}`}
                onClick={() => {
                  if (!canChangeRecord) return;
                  setSelectedRecordId(r.id);
                }}
                disabled={!canChangeRecord}
              >
                <div className={styles.itemTitle}>
                  {parseBookingMeta(r.appointment_note).full_name || r.patient_name || "-"}
                </div>
                <div className={styles.itemMeta}>HS #{r.id} | {formatSchedule(r)}</div>
              </button>
            ))}
            {!loading && filteredRecords.length === 0 ? (
              <div className={styles.empty}>Khong co ho so cho dich vu nay.</div>
            ) : null}
          </div>
          {isEditing ? <div className={styles.lockHint}>Dang o che do sua, khong the chuyen ho so khac.</div> : null}
        </section>

        <section className={styles.rightCard}>
          {!selectedRecord ? (
            <div className={styles.empty}>Vui long chon 1 ho so ben trai.</div>
          ) : (
            <div className={styles.infoGrid}>
              <div className={styles.blockWide}>
                <div className={styles.topRow}>
                  <div className={styles.versionWrap}>
                    <label className={styles.filterLabel}>Lich su ket qua</label>
                    <select
                      className={styles.filterSelect}
                      value={selectedVersionKey}
                      onChange={(e) => setSelectedVersionKey(e.target.value)}
                      disabled={isEditing}
                    >
                      {versions.map((version) => (
                        <option key={version.key} value={version.key}>
                          {version.label}
                        </option>
                      ))}
                    </select>
                    {loadingRevisions ? <div className={styles.smallMuted}>Dang tai lich su...</div> : null}
                  </div>

                  <div className={styles.actionRow}>
                    {!isEditing ? (
                      <>
                        <button
                          className={styles.actionButton}
                          onClick={() => {
                            setIsEditing(true);
                            setSelectedVersionKey("current");
                          }}
                          disabled={!viewingCurrentVersion}
                          title={!viewingCurrentVersion ? "Chi duoc sua o ban hien tai" : undefined}
                        >
                          Sua ket qua
                        </button>
                        <button
                          className={`${styles.actionButton} ${styles.actionDanger}`}
                          onClick={() => setShowDeleteConfirm(true)}
                          disabled={!viewingCurrentVersion}
                          title={!viewingCurrentVersion ? "Chi duoc xoa o ban hien tai" : undefined}
                        >
                          Xoa ket qua
                        </button>
                        <button
                          className={`${styles.actionButton} ${styles.actionGhost}`}
                          onClick={printCurrentRecord}
                        >
                          In phieu kham
                        </button>
                      </>
                    ) : (
                      <>
                        <button className={styles.actionButton} onClick={handleSaveEdit} disabled={savingEdit}>
                          {savingEdit ? "Dang luu..." : "Luu thay doi"}
                        </button>
                        <button
                          className={`${styles.actionButton} ${styles.actionGhost}`}
                          onClick={() => {
                            setIsEditing(false);
                            setEditDiagnosis(selectedRecord.diagnosis || "");
                            setEditNotes(selectedRecord.notes || "");
                          }}
                          disabled={savingEdit}
                        >
                          Huy
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.block}>
                <h4 className={styles.blockTitle}>Thong tin benh nhan</h4>
                <div><strong>Ho ten:</strong> {bookingMeta.full_name || selectedRecord.patient_name || "-"}</div>
                <div><strong>So dien thoai:</strong> {bookingMeta.phone || selectedRecord.patient_phone || "-"}</div>
                <div><strong>Gioi tinh:</strong> {bookingMeta.gender || "-"}</div>
                <div><strong>Nam sinh:</strong> {bookingMeta.birth_year || "-"}</div>
              </div>

              <div className={styles.block}>
                <h4 className={styles.blockTitle}>Thong tin lich kham</h4>
                <div><strong>Dich vu:</strong> {selectedRecord.service_name || "-"}</div>
                <div><strong>Lich kham:</strong> {formatSchedule(selectedRecord)}</div>
                <div><strong>Phong:</strong> {selectedRecord.room || "-"}</div>
                <div><strong>Trang thai:</strong> {statusLabel(selectedRecord.status)}</div>
              </div>

              <div className={styles.blockWide}>
                <h4 className={styles.blockTitle}>Thong tin kham</h4>
                <div><strong>Ly do kham:</strong> {bookingMeta.reason || "-"}</div>
                {!isEditing ? (
                  <>
                    <div><strong>Chan doan:</strong> {selectedVersion?.diagnosis || "-"}</div>
                    <div><strong>Ghi chu kham:</strong> {selectedVersion?.notes || "-"}</div>
                  </>
                ) : (
                  <div className={styles.editForm}>
                    <label className={styles.filterLabel}>Chan doan</label>
                    <textarea
                      className={styles.textarea}
                      value={editDiagnosis}
                      onChange={(e) => setEditDiagnosis(e.target.value)}
                      rows={3}
                    />
                    <label className={styles.filterLabel}>Ghi chu kham</label>
                    <textarea
                      className={styles.textarea}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={5}
                    />
                  </div>
                )}
              </div>

              <div className={styles.blockWide}>
                <h4 className={styles.blockTitle}>Don thuoc</h4>
                {!isEditing ? (
                  loadingPrescriptions ? (
                    <div className={styles.empty}>Dang tai don thuoc...</div>
                  ) : (selectedVersion?.prescriptionItems.length || 0) === 0 ? (
                    <div className={styles.empty}>Khong co thuoc duoc ke.</div>
                  ) : (
                    <div className={styles.medicineList}>
                      {(selectedVersion?.prescriptionItems || []).map((it, idx) => (
                        <div key={`${it.id || idx}`} className={styles.medicineItem}>
                          {idx + 1}. {it.medicine_name} | Lieu: {it.dosage} | Thoi gian dung: {it.duration}
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className={styles.editForm}>
                    {editPrescriptionItems.map((item, idx) => (
                      <div key={`edit-med-${idx}`} className={styles.prescriptionRow}>
                        <input
                          className={styles.textInput}
                          value={item.medicine_name}
                          onChange={(e) => updateEditPrescriptionItem(idx, "medicine_name", e.target.value)}
                          placeholder="Ten thuoc"
                        />
                        <select
                          className={styles.textInput}
                          value={item.dosage}
                          onChange={(e) => updateEditPrescriptionItem(idx, "dosage", e.target.value)}
                        >
                          <option value="">Lieu</option>
                          {DOSAGE_OPTIONS.map((opt) => (
                            <option key={`dosage-${opt}`} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        <select
                          className={styles.textInput}
                          value={item.duration}
                          onChange={(e) => updateEditPrescriptionItem(idx, "duration", e.target.value)}
                        >
                          <option value="">Thoi gian dung</option>
                          {DURATION_OPTIONS.map((opt) => (
                            <option key={`duration-${opt}`} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        <button
                          className={`${styles.actionButton} ${styles.actionGhost}`}
                          onClick={() => removeEditPrescriptionItem(idx)}
                          type="button"
                        >
                          Xoa
                        </button>
                      </div>
                    ))}
                    <div>
                      <button className={`${styles.actionButton} ${styles.actionGhost}`} onClick={addEditPrescriptionItem} type="button">
                        + Them thuoc
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {showDeleteConfirm && selectedRecord ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h4 className={styles.modalTitle}>Xac nhan xoa ket qua kham</h4>
            <p className={styles.modalText}>
              Ban chac chan muon xoa ho so #{selectedRecord.id}? Hanh dong nay khong the hoan tac.
            </p>
            <div className={styles.modalActions}>
              <button
                className={`${styles.actionButton} ${styles.actionGhost}`}
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingRecord}
              >
                Huy
              </button>
              <button
                className={`${styles.actionButton} ${styles.actionDanger}`}
                onClick={handleDeleteRecord}
                disabled={deletingRecord}
              >
                {deletingRecord ? "Dang xoa..." : "Xoa"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
