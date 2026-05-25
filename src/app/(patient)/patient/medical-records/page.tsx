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
    price: number | null;
  };
  doctor: {
    id: number | null;
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
  if (status === "pending") return "Cho xac nhan";
  if (status === "confirmed") return "Da xac nhan";
  if (status === "completed") return "Da hoan tat";
  if (status === "no_show") return "Vang mat";
  return "Da huy";
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
  const date = rawDate ? rawDate.slice(0, 10) : "-";
  const start = item.appointment.start_time ? item.appointment.start_time.slice(0, 5) : "--:--";
  const end = item.appointment.end_time ? item.appointment.end_time.slice(0, 5) : "--:--";
  return `${date} (${start} - ${end})`;
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
      const message = err instanceof Error ? err.message : "Khong the tai lich su kham";
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
      showToast("Xoa lich su kham thanh cong", "success");
      if (detailTarget?.item.medical_record.id === deleteTarget.medical_record.id) {
        setDetailTarget(null);
      }
      setDeleteTarget(null);
      await loadRecords();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the xoa lich su kham", "error");
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
      showToast(err instanceof Error ? err.message : "Khong the tai lich su sua", "error");
      setRevisionItems([]);
    } finally {
      setRevisionLoading(false);
    }
  }

  async function submitReview(item: MedicalRecordItem) {
    const draft = reviewDraft[item.medical_record.id];
    if (!draft || !draft.rating || draft.rating < 1 || draft.rating > 5) {
      showToast("Vui long chon so sao tu 1 den 5", "error");
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
      showToast("Luu danh gia thanh cong", "success");
      await loadRecords();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the luu danh gia", "error");
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

  if (loading) return <p className={styles.message}>Dang tai lich su kham...</p>;
  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Lich su kham benh</h2>

      <div className={styles.filters}>
        <select
          className={styles.control}
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
        >
          <option value="all">Tat ca dich vu</option>
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
        <p className={styles.message}>Chua co lich su kham nao.</p>
      ) : (
        <div className={styles.list}>
          {filteredRecords.map(({ item, meta, medicines }) => {
            return (
              <article key={item.medical_record.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.headerInfo}>
                    <div className={styles.codeLine}>Ho so #{item.medical_record.id}</div>
                    <div className={styles.infoSplit}>
                      <div className={styles.infoBoxUser}>
                        <div className={styles.infoBoxTitle}>Thong tin nguoi dung</div>
                        <div className={styles.headerLine}>
                          <strong>Ho ten:</strong> {meta.full_name || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>So dien thoai:</strong> {meta.phone || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Gioi tinh:</strong> {meta.gender || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Nam sinh:</strong> {meta.birth_year || "-"}
                        </div>
                      </div>
                      <div className={styles.infoBoxDoctor}>
                        <div className={styles.infoBoxTitle}>Thong tin bac si</div>
                        <div className={styles.headerLine}>
                          <strong>Bac si:</strong> {item.doctor.full_name || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Khoa:</strong> {item.specialty.name || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>Dich vu:</strong> {item.service.name || "-"}
                        </div>
                        <div className={styles.headerLine}>
                          <strong>So dien thoai BS:</strong> {item.doctor.phone || "-"}
                        </div>
                      </div>
                    </div>
                  </div>
                  <span className={`${styles.statusBadge} ${statusClass(item.appointment.status)}`}>
                    {statusLabel(item.appointment.status)}
                  </span>
                </div>

                <div className={styles.metaGrid}>
                  <div>
                    <strong>Lich kham:</strong> {formatSchedule(item)}
                  </div>
                  <div>
                    <strong>Gia tien:</strong> {Number(item.appointment.price || 0).toLocaleString("vi-VN")} d
                  </div>
                  <div>
                    <strong>So lan da sua:</strong> {item.medical_record.doctor_revision_count || 0}
                  </div>
                </div>

                <div className={styles.actions}>
                  {item.appointment.status === "completed" ? (
                    <button className={styles.secondaryBtn} onClick={() => setReviewTarget(item)}>
                      Danh gia
                    </button>
                  ) : null}
                  <button className={styles.secondaryBtn} onClick={() => setDetailTarget({ item, meta, medicines })}>
                    Chi tiet
                  </button>
                  <button className={styles.secondaryBtn} onClick={() => openRevisions(item)}>
                    Lich su sua
                  </button>
                  <button className={styles.dangerBtn} onClick={() => setDeleteTarget(item)}>
                    Xoa
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
            <h3 className={styles.modalTitle}>Chi tiet lich su kham</h3>
            <p className={styles.modalText}>
              <strong>Ly do kham:</strong> {detailTarget.meta.reason || "-"}
            </p>
            <p className={styles.modalText}>
              <strong>Chan doan:</strong> {detailTarget.item.medical_record.diagnosis || "Chua cap nhat"}
            </p>
            <p className={styles.modalText}>
              <strong>Ghi chu kham:</strong> {detailTarget.item.medical_record.notes || "Chua cap nhat"}
            </p>
            <p className={styles.modalText}>
              <strong>So lan bac si sua:</strong> {detailTarget.item.medical_record.doctor_revision_count || 0}
            </p>
            <div className={styles.detailBox}>
  <strong>Danh sach thuoc:</strong>

  {detailTarget.medicines.length === 0 ? (
    <p className={styles.noDrug}>Chua co thuoc duoc ke.</p>
  ) : (
    <table className={styles.drugTable}>
      <thead>
        <tr>
          <th>Ten thuoc</th>
          <th>Lieu dung</th>
          <th>Thoi gian dung</th>
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
                Dong
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Xac nhan xoa lich su kham</h3>
            <p className={styles.modalText}>
              Ban co chac chan muon xoa ho so #{deleteTarget.medical_record.id} khong?
            </p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Huy
              </button>
              <button className={styles.dangerBtn} onClick={confirmDeleteRecord} disabled={deleting}>
                {deleting ? "Dang xoa..." : "Xac nhan xoa"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {revisionTarget ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Lich su bac si chinh sua</h3>
            {revisionLoading ? (
              <p className={styles.modalText}>Dang tai du lieu...</p>
            ) : revisionItems.length === 0 ? (
              <p className={styles.modalText}>Chua co lan sua nao.</p>
            ) : (
              <div className={styles.revisionList}>
                {revisionItems.map((r, idx) => (
                  <div key={`rev-${r.id}`} className={styles.revisionItem}>
                    <div className={styles.revisionItemTitle}>Lan sua {idx + 1} - {new Date(r.created_at).toLocaleString("vi-VN")}</div>
                    <div><strong>Chan doan:</strong> {r.diagnosis || "-"}</div>
                    <div><strong>Ghi chu:</strong> {r.notes || "-"}</div>
                    <div><strong>Thuoc:</strong></div>
                    {r.prescription_items.length === 0 ? (
                      <div>- Khong co du lieu thuoc.</div>
                    ) : (
                      <ul className={styles.drugList}>
                        {r.prescription_items.map((d, i) => (
                          <li key={`rev-drug-${r.id}-${i}`}>
                            {d.medicine_name} | Lieu: {d.dosage || "-"} | Thoi gian dung: {d.duration || "-"}
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
                Dong
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reviewTarget ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Danh gia bac si</h3>
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
                placeholder="Nhan xet cua ban (neu co)"
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setReviewTarget(null)}>
                Huy
              </button>
              <button
                className={styles.secondaryBtn}
                onClick={async () => {
                  await submitReview(reviewTarget);
                  setReviewTarget(null);
                }}
                disabled={reviewSubmittingId === reviewTarget.medical_record.id}
              >
                {reviewSubmittingId === reviewTarget.medical_record.id ? "Dang luu..." : "Luu danh gia"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
