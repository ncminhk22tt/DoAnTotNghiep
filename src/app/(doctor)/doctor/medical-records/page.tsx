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
    phone: readByPrefix("Số điện thoại:"),
    gender: readByPrefix("Giới tính:"),
    birth_year: readByPrefix("Năm sinh:"),
    reason: readByPrefix("Lý do khám:"),
  };
}

function statusLabel(status: MedicalRecordRow["status"]) {
  if (status === "pending") return "Chờ xác nhận";
  if (status === "confirmed") return "Đã xác nhận";
  if (status === "completed") return "Đã hoàn tất";
  if (status === "cancelled") return "Đã hủy";
  return "-";
}

function formatSchedule(row: MedicalRecordRow) {
  if (!row.work_date) return "-";
  const parsedDate = new Date(row.work_date);
  const dateText = Number.isNaN(parsedDate.getTime())
    ? row.work_date.slice(0, 10)
    : `${String(parsedDate.getDate()).padStart(2, "0")}-${String(parsedDate.getMonth() + 1).padStart(2, "0")}-${parsedDate.getFullYear()}`;
  const start = row.start_time ? row.start_time.slice(0, 5) : "--:--";
  const end = row.end_time ? row.end_time.slice(0, 5) : "--:--";
  return `${dateText} (${start} - ${end})`;
}

function formatDisplayDate(date: string | null) {
  if (!date) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-");
    return `${day}-${month}-${year}`;
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatDisplayDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
  const time = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);

  return `${formatDisplayDate(date)} ${time}`;
}

function formatRevisionLabel(createdAt: string, idx: number) {
  return `Lần sửa ${idx + 1} - ${formatDisplayDateTime(createdAt)}`;
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
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingRecord, setDeletingRecord] = useState(false);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [selectedVersionKey, setSelectedVersionKey] = useState("current");

  useEffect(() => {
    document.title = "---";
  }, []);

  function clearFilters() {
    setServiceFilter("all");
    setDateFilter("");
  }

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
      showToast(error instanceof Error ? error.message : "Không thể tải thông tin khám", "error");
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
      showToast(error instanceof Error ? error.message : "Không thể tải đơn thuốc", "error");
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
      label: "Kết quả hiện tại",
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
      showToast("Chẩn đoán không được để trống", "error");
      return;
    }
    const { hasPartialRow, validItems: validPrescriptionItems } = validatePrescriptionItems(editPrescriptionItems);
    if (hasPartialRow) {
      showToast("Thông tin thuốc chưa đầy đủ. Mỗi dòng cần đủ Tên thuốc, Liều, Thời gian dùng.", "error");
      return;
    }

    try {
      setShowSaveConfirm(false);
      setSavingEdit(true);
      const token = getAccessToken();
      await apiClient.patch<{ success: boolean; message?: string }>(
        `/api/doctor/medical-records/${selectedRecord.id}`,
        { diagnosis: editDiagnosis.trim(), notes: editNotes.trim() },
        token
      );

      const targetPrescriptionId = prescriptions[0]?.id;
      if (validPrescriptionItems.length > 0 && targetPrescriptionId) {
        await apiClient.patch<{ success: boolean; message?: string }>(
          `/api/doctor/prescriptions/${targetPrescriptionId}`,
          { items: validPrescriptionItems },
          token
        );
      } else if (validPrescriptionItems.length > 0) {
        await apiClient.post<{ success: boolean; message?: string }>(
          `/api/doctor/medical-records/${selectedRecord.id}/prescriptions`,
          { items: validPrescriptionItems },
          token
        );
      } else if (targetPrescriptionId) {
        await apiClient.delete<{ success: boolean; message?: string }>(
          `/api/doctor/prescriptions/${targetPrescriptionId}`,
          token
        );
      }

      showToast("Đã cập nhật kết quả khám và đơn thuốc", "success");
      setIsEditing(false);
      setSelectedVersionKey("current");
      await loadRecords();
      await loadPrescriptions(selectedRecord.id);
      await loadRevisions(selectedRecord.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể cập nhật kết quả khám", "error");
    } finally {
      setSavingEdit(false);
    }
  }

  function requestSaveEdit() {
    if (!selectedRecord || savingEdit) return;
    setShowSaveConfirm(true);
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
      showToast("Đã xóa kết quả khám", "success");
      setShowDeleteConfirm(false);
      setIsEditing(false);
      setSelectedVersionKey("current");
      setPrescriptions([]);
      setRevisions([]);
      await loadRecords();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể xóa kết quả khám", "error");
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
  <title></title>
</head>
<body style=\"font-family:Arial,sans-serif;padding:20px;color:#111;\">
  <div style=\"margin:0 0 18px;font-family:'Segoe UI',Arial,sans-serif;font-size:24px;font-weight:800;line-height:1.2;text-align:center;letter-spacing:0.5px;\">PHIẾU KHÁM BỆNH</div>
  <div style=\"margin-bottom:14px;\">
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

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    iframe.srcdoc = html;

    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 1000);
    };

    iframe.onload = () => {
      const frameWindow = iframe.contentWindow;
      if (!frameWindow) {
        cleanup();
        return;
      }
      frameWindow.focus();
      frameWindow.print();
      cleanup();
    };

    document.body.appendChild(iframe);
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Thông tin khám bệnh</h2>

      <div className={styles.layout}>
        <section className={styles.leftCard}>
          <h3 className={styles.subTitle}>Danh sách hồ sơ đã khám</h3>
          <div className={styles.filterRow}>
            <label className={styles.filterLabel}>Chọn dịch vụ</label>
            <select
              className={styles.filterSelect}
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              disabled={!canChangeRecord}
            >
              <option value="all">Tất cả dịch vụ</option>
              {serviceOptions.map((serviceName) => (
                <option key={serviceName} value={serviceName}>
                  {serviceName}
                </option>
              ))}
            </select>
            <label className={styles.filterLabel}>Chọn ngày</label>
            <input
              type="date"
              className={styles.filterSelect}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              disabled={!canChangeRecord}
            />
          </div>
          <button
            className={styles.clearFilterButton}
            type="button"
            onClick={clearFilters}
            disabled={!canChangeRecord || (serviceFilter === "all" && !dateFilter)}
          >
            Xóa lọc
          </button>
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
                  Tên: {parseBookingMeta(r.appointment_note).full_name || r.patient_name || "-"}
                </div>
                <div className={styles.itemMeta}>
                  <div>Số điện thoại: {parseBookingMeta(r.appointment_note).phone || r.patient_phone || "-"}</div>
                  <div>Dịch vụ: {r.service_name || "-"}</div>
                  <div>
                    Ngày khám: {formatDisplayDate(r.work_date)} ({r.start_time?.slice(0, 5) || "--:--"} -{" "}
                    {r.end_time?.slice(0, 5) || "--:--"})
                  </div>
                </div>
              </button>
            ))}
            {!loading && filteredRecords.length === 0 ? (
              <div className={styles.empty}>Không có hồ sơ cho dịch vụ này.</div>
            ) : null}
          </div>
          {isEditing ? <div className={styles.lockHint}>Đang ở chế độ sửa, không thể chuyển hồ sơ khác.</div> : null}
        </section>

        <section className={styles.rightCard}>
          {!selectedRecord ? (
            <div className={styles.empty}>Không có kết quả</div>
          ) : (
            <div className={styles.infoGrid}>
              <div className={styles.blockWide}>
                <div className={styles.topRow}>
                  <div className={styles.versionWrap}>
                    <label className={styles.filterLabel}>Lịch sử kết quả</label>
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
                    {loadingRevisions ? <div className={styles.smallMuted}>Đang tải lịch sử...</div> : null}
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
                          title={!viewingCurrentVersion ? "Chỉ được sửa ở bản hiện tại" : undefined}
                        >
                          Sửa kết quả
                        </button>
                        <button
                          className={`${styles.actionButton} ${styles.actionGhost}`}
                          onClick={printCurrentRecord}
                        >
                          In phiếu khám
                        </button>
                      </>
                    ) : (
                      <>
                        <button className={styles.actionButton} onClick={requestSaveEdit} disabled={savingEdit}>
                          {savingEdit ? "Đang lưu..." : "Lưu thay đổi"}
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
                          Hủy
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.block}>
                <h4 className={styles.blockTitle}>Thông tin bệnh nhân</h4>
                <div><strong>Họ tên:</strong> {bookingMeta.full_name || selectedRecord.patient_name || "-"}</div>
                <div><strong>Số điện thoại:</strong> {bookingMeta.phone || selectedRecord.patient_phone || "-"}</div>
                <div><strong>Giới tính:</strong> {bookingMeta.gender || "-"}</div>
                <div><strong>Năm sinh:</strong> {bookingMeta.birth_year || "-"}</div>
              </div>

              <div className={styles.block}>
                <h4 className={styles.blockTitle}>Thông tin lịch khám</h4>
                <div><strong>Dịch vụ:</strong> {selectedRecord.service_name || "-"}</div>
                <div><strong>Lịch khám:</strong> {formatSchedule(selectedRecord)}</div>
                <div><strong>Phòng:</strong> {selectedRecord.room || "-"}</div>
                <div><strong>Trạng thái:</strong> {statusLabel(selectedRecord.status)}</div>
              </div>

              <div className={styles.blockWide}>
                <h4 className={styles.blockTitle}>Thông tin khám</h4>
                <div><strong>Lý do khám:</strong> {bookingMeta.reason || "-"}</div>
                {!isEditing ? (
                  <>
                    <div><strong>Chẩn đoán:</strong> {selectedVersion?.diagnosis || "-"}</div>
                    <div><strong>Ghi chú khám:</strong> {selectedVersion?.notes || "-"}</div>
                  </>
                ) : (
                  <div className={styles.editForm}>
                    <label className={styles.filterLabel}>Chẩn đoán</label>
                    <textarea
                      className={styles.textarea}
                      value={editDiagnosis}
                      onChange={(e) => setEditDiagnosis(e.target.value)}
                      rows={3}
                    />
                    <label className={styles.filterLabel}>Ghi chú khám</label>
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
                <h4 className={styles.blockTitle}>Đơn thuốc</h4>
                {!isEditing ? (
                  loadingPrescriptions ? (
                    <div className={styles.empty}>Đang tải đơn thuốc...</div>
                  ) : (selectedVersion?.prescriptionItems.length || 0) === 0 ? (
                    <div className={styles.empty}>Không có thuốc được kê.</div>
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.tableHead}>#</th>
                            <th className={styles.tableHead}>Tên thuốc</th>
                            <th className={styles.tableHead}>Liều</th>
                            <th className={styles.tableHead}>Thời gian dùng</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedVersion?.prescriptionItems || []).map((it, idx) => (
                            <tr key={`${it.id || idx}`}>
                              <td className={styles.tableCell}>{idx + 1}</td>
                              <td className={styles.tableCell}>{it.medicine_name}</td>
                              <td className={styles.tableCell}>{it.dosage}</td>
                              <td className={styles.tableCell}>{it.duration}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
                          placeholder="Tên thuốc"
                        />
                        <select
                          className={styles.textInput}
                          value={item.dosage}
                          onChange={(e) => updateEditPrescriptionItem(idx, "dosage", e.target.value)}
                        >
                          <option value="">Liều</option>
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
                          <option value="">Thời gian dùng</option>
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
                          Xóa
                        </button>
                      </div>
                    ))}
                    <div>
                      <button className={`${styles.actionButton} ${styles.actionGhost}`} onClick={addEditPrescriptionItem} type="button">
                        + Thêm thuốc
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
            <h4 className={styles.modalTitle}>Xác nhận xóa kết quả khám</h4>
            <p className={styles.modalText}>
              Bạn chắc chắn muốn xóa hồ sơ #{selectedRecord.id}? Hành động này không thể hoàn tác.
            </p>
            <div className={styles.modalActions}>
              <button
                className={`${styles.actionButton} ${styles.actionGhost}`}
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingRecord}
              >
                Hủy
              </button>
              <button
                className={`${styles.actionButton} ${styles.actionDanger}`}
                onClick={handleDeleteRecord}
                disabled={deletingRecord}
              >
                {deletingRecord ? "Đang xóa..." : "Xóa"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showSaveConfirm && selectedRecord ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h4 className={styles.modalTitle}>Xác nhận lưu thay đổi</h4>
            <p className={styles.modalText}>Bạn chắc chắn muốn lưu cập nhật?</p>
            <div className={styles.modalActions}>
              <button
                className={`${styles.actionButton} ${styles.actionGhost}`}
                onClick={() => setShowSaveConfirm(false)}
                disabled={savingEdit}
              >
                Hủy
              </button>
              <button
                className={`${styles.actionButton}`}
                onClick={handleSaveEdit}
                disabled={savingEdit}
              >
                {savingEdit ? "Đang lưu..." : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

