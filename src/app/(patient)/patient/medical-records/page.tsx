"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./medical-records.module.css";

type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

type PrescriptionItem = {
  id: number;
  medicine_name: string;
  dosage: string;
  duration: string;
};

type MedicalRecordItem = {
  medical_record: {
    id: number;
    appointment_id: number;
    diagnosis: string | null;
    notes: string | null;
    created_at: string | null;
    doctor_revision_count: number;
  };
  appointment: {
    id: number;
    status: AppointmentStatus;
    note: string | null;
    created_at: string;
    work_date: string | null;
    start_time: string | null;
    end_time: string | null;
    room?: string | null;
    price: number | null;
  };
  doctor: {
    id: number | null;
    code?: string | null;
    full_name: string | null;
    phone: string | null;
  };
  specialty: {
    id: number | null;
    name: string | null;
  };
  service: {
    id: number | null;
    name: string | null;
  };
  prescriptions: Array<{
    id: number;
    medical_record_id: number;
    items: PrescriptionItem[];
  }>;
  review?: {
    id: number | null;
    rating: number | null;
    comment: string | null;
  };
};

type RevisionItem = {
  id: number;
  diagnosis: string | null;
  notes: string | null;
  created_at: string;
  prescription_items: Array<{
    medicine_name: string;
    dosage: string;
    duration: string;
  }>;
};

type BookingMeta = {
  full_name: string | null;
  phone: string | null;
  gender: string | null;
  birth_year: string | null;
  reason: string | null;
};

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
    .map((line) => line.trim())
    .filter(Boolean);

  const read = (prefix: string) => {
    const found = lines.find((line) => line.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!found) return null;
    const value = found.slice(prefix.length).trim();
    return value || null;
  };

  return {
    full_name: read("Ho va ten:"),
    phone: read("So dien thoai:"),
    gender: read("Gioi tinh:"),
    birth_year: read("Nam sinh:"),
    reason: read("Ly do kham:"),
  };
}

function statusLabel(status: AppointmentStatus) {
  if (status === "pending") return "Chờ xác nhận";
  if (status === "confirmed") return "Đã xác nhận";
  if (status === "completed") return "Đã hoàn tất";
  if (status === "no_show") return "Vắng mặt";
  return "Đã hủy";
}

function statusClass(status: AppointmentStatus) {
  if (status === "pending") return styles.statusPending;
  if (status === "confirmed") return styles.statusConfirmed;
  if (status === "completed") return styles.statusCompleted;
  if (status === "no_show") return styles.statusCancelled;
  return styles.statusCancelled;
}

function formatSchedule(item: MedicalRecordItem) {
  const rawDate = item.appointment.work_date || "";
  let date = "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    date = rawDate;
  } else if (rawDate) {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(parsed);
    } else {
      date = rawDate.slice(0, 10);
    }
  }
  const start = item.appointment.start_time ? item.appointment.start_time.slice(0, 5) : "--:--";
  const end = item.appointment.end_time ? item.appointment.end_time.slice(0, 5) : "--:--";
  return `${date} (${start} - ${end})`;
}

function countChars(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return normalized.length;
}

export default function PatientMedicalRecordsPage() {
  const { showToast } = useToast();

  const [records, setRecords] = useState<MedicalRecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");

  const [detailTarget, setDetailTarget] = useState<{
    item: MedicalRecordItem;
    meta: BookingMeta;
    medicines: PrescriptionItem[];
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MedicalRecordItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [revisionTarget, setRevisionTarget] = useState<MedicalRecordItem | null>(null);
  const [revisionItems, setRevisionItems] = useState<RevisionItem[]>([]);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [reviewSubmittingId, setReviewSubmittingId] = useState<number | null>(null);
  const [reviewDraft, setReviewDraft] = useState<Record<number, { rating: number; comment: string }>>({});
  const [reviewTarget, setReviewTarget] = useState<MedicalRecordItem | null>(null);

  async function loadRecords() {
    try {
      setLoading(true);
      setError("");
      const token = getAccessToken();
      const res = await apiClient.get<{ data: MedicalRecordItem[] }>("/api/patient/medical-records", token);
      setRecords(res.data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Không thể tải lịch sử khám";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmDeleteRecord() {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      const token = getAccessToken();
      await apiClient.delete(`/api/patient/medical-records/${deleteTarget.medical_record.id}`, token);
      showToast("Xóa lịch sử khám thành công", "success");
      if (detailTarget?.item.medical_record.id === deleteTarget.medical_record.id) {
        setDetailTarget(null);
      }
      setDeleteTarget(null);
      await loadRecords();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể xóa lịch sử khám", "error");
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    loadRecords();
  }, []);

  async function openRevisions(item: MedicalRecordItem) {
    try {
      setRevisionTarget(item);
      setRevisionLoading(true);
      const token = getAccessToken();
      const res = await apiClient.get<{ data: RevisionItem[] }>(
        `/api/patient/medical-records/${item.medical_record.id}/revisions`,
        token
      );
      setRevisionItems(res.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể tải lịch sử sửa", "error");
      setRevisionItems([]);
    } finally {
      setRevisionLoading(false);
    }
  }

  async function submitReview(item: MedicalRecordItem) {
    const draft = reviewDraft[item.medical_record.id];
    if (!draft || !draft.rating || draft.rating < 1 || draft.rating > 5) {
      showToast("Vui lòng chọn số sao từ 1 đến 5", "error");
      return;
    }
    if (countChars(draft.comment || "") > 100) {
      showToast("Nhận xét tối đa 100 ký tự", "error");
      return;
    }

    try {
      setReviewSubmittingId(item.medical_record.id);
      const token = getAccessToken();
      await apiClient.post(
        "/api/patient/reviews",
        {
          appointment_id: item.appointment.id,
          rating: draft.rating,
          comment: draft.comment || null,
        },
        token
      );
      showToast("Lưu đánh giá thành công", "success");
      await loadRecords();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể lưu đánh giá", "error");
    } finally {
      setReviewSubmittingId(null);
    }
  }

  const recordsWithMeta = useMemo(
    () =>
      records.map((item) => ({
        item,
        meta: parseBookingMeta(item.appointment.note),
        medicines: item.prescriptions.flatMap((p) => p.items || []),
      })),
    [records]
  );

  const serviceOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        recordsWithMeta
          .map((row) => (row.item.service.name || "").trim())
          .filter(Boolean)
      )
    );
    return names.sort((a, b) => a.localeCompare(b));
  }, [recordsWithMeta]);

  const filteredRecords = useMemo(() => {
    return recordsWithMeta.filter(({ item }) => {
      const byService =
        serviceFilter === "all" ||
        (item.service.name || "").trim() === serviceFilter;
      const byDate =
        !dateFilter || (item.appointment.work_date || "") === dateFilter;
      return byService && byDate;
    });
  }, [recordsWithMeta, serviceFilter, dateFilter]);

  if (loading) return <p className={styles.message}>Đang tải lịch sử khám...</p>;
  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Lịch sử khám bệnh</h2>

      <div className={styles.filters}>
        <select
          className={styles.control}
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
        >
          <option value="all">Tất cả dịch vụ</option>
          {serviceOptions.map((serviceName) => (
            <option key={serviceName} value={serviceName}>
              {serviceName}
            </option>
          ))}
        </select>

        <input
          className={styles.control}
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        />
      </div>

      {filteredRecords.length === 0 ? (
        <p className={styles.message}>Chưa có lịch sử khám nào.</p>
      ) : (
        <div className={styles.list}>
          {filteredRecords.map(({ item, meta, medicines }) => {
            return (
              <article key={item.medical_record.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.headerInfo}>
                    <div className={styles.infoSplit}>
                      <div className={styles.infoBoxUser}>
                        <div className={styles.infoBoxTitle}>Thông tin người dùng</div>
                        <div className={styles.headerLine}>
                          <strong>Họ tên:</strong> {meta.full_name || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Số điện thoại:</strong> {meta.phone || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Giới tính:</strong> {meta.gender || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Năm sinh:</strong> {meta.birth_year || "-"}
                        </div>
                      </div>
                      <div className={styles.infoBoxDoctor}>
                        <div className={styles.infoBoxTitle}>Thông tin bác sĩ</div>
                        <div className={styles.headerLine}>
                          <strong>Bác sĩ:</strong> {item.doctor.full_name || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Mã bác sĩ:</strong> {item.doctor.code || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Số điện thoại:</strong> {item.doctor.phone || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Khoa:</strong> {item.specialty.name || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Dịch vụ:</strong> {item.service.name || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Phòng:</strong> {item.appointment.room || "-"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.metaGrid}>
                  <div>
                    <strong>Lịch khám:</strong> {formatSchedule(item)}
                  </div>
                  <div>
                    <strong>Giá tiền:</strong> {Number(item.appointment.price || 0).toLocaleString("vi-VN")} đ
                  </div>
                  <div>
                    <strong>Số lần đã sửa:</strong> {item.medical_record.doctor_revision_count || 0}
                  </div>
                </div>

                <div className={styles.actions}>
                  {item.appointment.status === "completed" ? (
                    <button className={styles.secondaryBtn} onClick={() => setReviewTarget(item)}>
                      Đánh giá
                    </button>
                  ) : null}
                  <button className={styles.secondaryBtn} onClick={() => setDetailTarget({ item, meta, medicines })}>
                    Chi tiết
                  </button>
                  <button className={styles.secondaryBtn} onClick={() => openRevisions(item)}>
                    Lịch sử sửa
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {detailTarget ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Chi tiết lịch sử khám</h3>
            <p className={styles.modalText}>
              <strong>Lý do khám:</strong> {detailTarget.meta.reason || "-"}
            </p>
            <p className={styles.modalText}>
              <strong>Chẩn đoán:</strong> {detailTarget.item.medical_record.diagnosis || "Chưa cập nhật"}
            </p>
            <p className={styles.modalText}>
              <strong>Ghi chú khám:</strong> {detailTarget.item.medical_record.notes || "Chưa cập nhật"}
            </p>
            <p className={styles.modalText}>
              <strong>Số lần bác sĩ sửa:</strong> {detailTarget.item.medical_record.doctor_revision_count || 0}
            </p>
            <div className={styles.detailBox}>
  <strong>Danh sách thuốc:</strong>

  {detailTarget.medicines.length === 0 ? (
    <p className={styles.noDrug}>Chưa có thuốc được kê.</p>
  ) : (
    <table className={styles.drugTable}>
      <thead>
        <tr>
          <th>Tên thuốc</th>
          <th>Liều dùng</th>
          <th>Thời gian dùng</th>
        </tr>
      </thead>

      <tbody>
        {detailTarget.medicines.map((drug, idx) => (
          <tr key={`${drug.id}-${idx}`}>
            <td>{drug.medicine_name}</td>
            <td>{drug.dosage || "-"}</td>
            <td>{drug.duration || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
</div>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setDetailTarget(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Xác nhận xóa lịch sử khám</h3>
            <p className={styles.modalText}>
              Bạn có chắc chắn muốn xóa hồ sơ #{deleteTarget.medical_record.id} không?
            </p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Hủy
              </button>
              <button className={styles.dangerBtn} onClick={confirmDeleteRecord} disabled={deleting}>
                {deleting ? "Đang xóa..." : "Xác nhận xóa"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {revisionTarget ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Lịch sử bác sĩ chỉnh sửa</h3>
            {revisionLoading ? (
              <p className={styles.modalText}>Đang tải dữ liệu...</p>
            ) : revisionItems.length === 0 ? (
              <p className={styles.modalText}>Chưa có lần sửa nào.</p>
            ) : (
              <div className={styles.revisionList}>
                {revisionItems.map((r, idx) => (
                  <div key={`rev-${r.id}`} className={styles.revisionItem}>
                    <div className={styles.revisionItemTitle}>Lần sửa {idx + 1} - {new Date(r.created_at).toLocaleString("vi-VN")}</div>
                    <div><strong>Chẩn đoán:</strong> {r.diagnosis || "-"}</div>
                    <div><strong>Ghi chú:</strong> {r.notes || "-"}</div>
                    <div><strong>Thuốc:</strong></div>
                    {r.prescription_items.length === 0 ? (
                      <div>- Không có dữ liệu thuốc.</div>
                    ) : (
                      <ul className={styles.drugList}>
                        {r.prescription_items.map((d, i) => (
                          <li key={`rev-drug-${r.id}-${i}`}>
                            {d.medicine_name} | Liều: {d.dosage || "-"} | Thời gian dùng: {d.duration || "-"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setRevisionTarget(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reviewTarget ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Đánh giá bác sĩ</h3>
            <div className={styles.reviewBox}>
              <div className={styles.reviewRow}>
                <select
                  className={styles.control}
                  value={String(reviewDraft[reviewTarget.medical_record.id]?.rating || reviewTarget.review?.rating || 5)}
                  onChange={(e) =>
                    setReviewDraft((prev) => ({
                      ...prev,
                      [reviewTarget.medical_record.id]: {
                        rating: Number(e.target.value),
                        comment: prev[reviewTarget.medical_record.id]?.comment ?? reviewTarget.review?.comment ?? "",
                      },
                    }))
                  }
                >
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={`rating-modal-${reviewTarget.medical_record.id}-${n}`} value={n}>
                      {n} sao
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className={styles.reviewTextarea}
                value={reviewDraft[reviewTarget.medical_record.id]?.comment ?? reviewTarget.review?.comment ?? ""}
                onChange={(e) =>
                  setReviewDraft((prev) => ({
                    ...prev,
                    [reviewTarget.medical_record.id]: {
                      rating: prev[reviewTarget.medical_record.id]?.rating ?? reviewTarget.review?.rating ?? 5,
                      comment: e.target.value,
                    },
                  }))
                }
                placeholder="Nhận xét của bạn (tối đa 100 ký tự)"
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setReviewTarget(null)}>
                Hủy
              </button>
              <button
                className={styles.secondaryBtn}
                onClick={async () => {
                  await submitReview(reviewTarget);
                  setReviewTarget(null);
                }}
                disabled={reviewSubmittingId === reviewTarget.medical_record.id}
              >
                {reviewSubmittingId === reviewTarget.medical_record.id ? "Đang lưu..." : "Lưu đánh giá"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
