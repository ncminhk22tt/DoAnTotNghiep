"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "../appointments/appointments.module.css";

type PaymentStatusFilter = "all" | "unpaid" | "paid";

type PaymentRow = {
  id: number;
  user_id: number;
  patient_name: string | null;
  patient_phone: string | null;
  doctor_name: string | null;
  doctor_code: string | null;
  service_name: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  price: number | null;
  payment_status: "unpaid" | "paid";
  paid_at: string | null;
  completed_at?: string | null;
};

type ServiceItem = {
  id: number;
  name: string;
};

type DoctorItem = {
  id: number;
  full_name: string;
  doctor_code: string | null;
};

function formatTime(item: PaymentRow) {
  const date = formatDisplayDate(item.work_date);
  const start = item.start_time ? item.start_time.slice(0, 5) : "--:--";
  const end = item.end_time ? item.end_time.slice(0, 5) : "--:--";
  return `${date} (${start} - ${end})`;
}

function paymentLabel(status: PaymentStatusFilter | "unpaid" | "paid") {
  if (status === "unpaid") return "Chưa thanh toán";
  if (status === "paid") return "Đã thanh toán";
  return "Tất cả";
}

function getPaymentBadgeClass(status: "unpaid" | "paid") {
  return status === "paid" ? styles.badgePaid : styles.badgeUnpaid;
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "-";
  const rawDate = value.includes("T") ? value.split("T")[0] : value.split(" ")[0];
  const [year, month, day] = rawDate.split("-");
  if (!year || !month || !day) return value;
  return `${day}-${month}-${year}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = formatDisplayDate(value);
  const rawTime = value.includes("T") ? value.split("T")[1] : value.split(" ")[1];
  const time = rawTime ? rawTime.slice(0, 5) : "";
  return time ? `${date} ${time}` : date;
}

export default function AdminPaymentsPage() {
  const { showToast } = useToast();
  const [dateFilter, setDateFilter] = useState<string>("");
  const [items, setItems] = useState<PaymentRow[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [doctors, setDoctors] = useState<DoctorItem[]>([]);
  const [serviceId, setServiceId] = useState(0);
  const [doctorId, setDoctorId] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatusFilter>("unpaid");
  const [loading, setLoading] = useState(false);
  const [confirmPaymentId, setConfirmPaymentId] = useState<number | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  async function loadServices() {
    try {
      const token = getAccessToken("admin");
      const res = await apiClient.get<{ data: ServiceItem[] }>("/api/admin/services", token);
      setServices(res.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể tải danh sách dịch vụ", "error");
    }
  }

  async function loadDoctors() {
    try {
      const token = getAccessToken("admin");
      const res = await apiClient.get<{ data: DoctorItem[] }>("/api/admin/doctors/users", token);
      setDoctors(res.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể tải danh sách bác sĩ", "error");
    }
  }

  async function loadPayments() {
    setLoading(true);
    try {
      const token = getAccessToken("admin");
      const params = new URLSearchParams();
      params.set("status", "completed");
      if (paymentStatus !== "all") params.set("payment_status", paymentStatus);
      if (dateFilter) params.set("date", dateFilter);
      if (serviceId > 0) params.set("service_id", String(serviceId));
      if (doctorId > 0) params.set("doctor_id", String(doctorId));
      const query = params.toString();
      const res = await apiClient.get<{ data: PaymentRow[] }>(
        `/api/admin/appointments${query ? `?${query}` : ""}`,
        token
      );
      setItems(res.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể tải danh sách thanh toán", "error");
    } finally {
      setLoading(false);
    }
  }

  async function confirmPayment(appointmentId: number) {
    setConfirmingPayment(true);
    try {
      const token = getAccessToken("admin");
      await apiClient.patch(`/api/admin/appointments/${appointmentId}/pay`, {}, token);
      showToast("Đã thanh toán cho bệnh nhân", "success");
      setConfirmPaymentId(null);
      setPaymentStatus("unpaid");
      setServiceId(0);
      setDoctorId(0);
      await loadPayments();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể cập nhật thanh toán", "error");
    } finally {
      setConfirmingPayment(false);
    }
  }

  function resetFilters() {
    setPaymentStatus("unpaid");
    setDateFilter("");
    setServiceId(0);
    setDoctorId(0);
  }

  useEffect(() => {
    loadServices();
    loadDoctors();
  }, []);

  useEffect(() => {
    loadPayments();
  }, []);

  useEffect(() => {
    loadPayments();
  }, [paymentStatus, serviceId, doctorId, dateFilter]);

  const noData = !loading && items.length === 0;

  return (
    <div className={styles.page}>
      {/* <h2 className={styles.title}>Thanh toán lịch đã khám</h2>
      <p className={styles.subTitle}>Chọn bộ lọc bên trái để xem danh sách bệnh nhân đã khám xong</p> */}

      <div className={styles.mainGrid}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}>
            <h3 className={styles.sidebarTitle}>Bộ lọc</h3>
            <button type="button" className={styles.secondaryBtn} onClick={resetFilters}>
              Xóa lọc
            </button>
          </div>

          <div className={styles.filterGroup}>
            <label htmlFor="paymentStatus">Trạng thái thanh toán</label>
            <select
              id="paymentStatus"
              className={styles.control}
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value as PaymentStatusFilter)}
            >
              <option value="unpaid">Chưa thanh toán</option>
              <option value="paid">Đã thanh toán</option>
              <option value="all">Tất cả</option>
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label htmlFor="dateFilter">Ngày khám</label>
            <input
              id="dateFilter"
              className={styles.control}
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>

          <div className={styles.filterGroup}>
            <label htmlFor="serviceId">Dịch vụ</label>
            <select
              id="serviceId"
              className={styles.control}
              value={serviceId}
              onChange={(e) => setServiceId(Number(e.target.value))}
            >
              <option value={0}>Tất cả dịch vụ</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label htmlFor="doctorId">Bác sĩ</label>
            <select
              id="doctorId"
              className={styles.control}
              value={doctorId}
              onChange={(e) => setDoctorId(Number(e.target.value))}
            >
              <option value={0}>Tất cả bác sĩ</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.full_name} {doctor.doctor_code ? `(${doctor.doctor_code})` : ""}
                </option>
              ))}
            </select>
          </div>
        </aside>

        <section className={styles.results}>
          {loading ? (
            <p>Đang tải danh sách...</p>
          ) : noData ? (
            <p className={styles.empty}>Không có lịch khám hoàn tất phù hợp.</p>
          ) : (
            <div className={styles.list}>
              {items.map((item) => (
                <article key={item.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <h3 className={styles.cardTitle}>Bệnh nhân: {item.patient_name || "-"}</h3>
                    <span className={`${styles.badge} ${getPaymentBadgeClass(item.payment_status)}`}>
                      {paymentLabel(item.payment_status)}
                    </span>
                  </div>
                  <div className={styles.grid}>
                    <p><strong>SĐT:</strong> {item.patient_phone || "-"}</p>
                    <p><strong>Bác sĩ:</strong> {item.doctor_name || "-"} ({item.doctor_code || "-"})</p>
                    <p><strong>Dịch vụ:</strong> {item.service_name || "-"}</p>
                    <p><strong>Giá tiền:</strong> {item.price ? Number(item.price).toLocaleString("vi-VN") : 0} đ</p>
                    <p><strong>Ngày hoàn tất:</strong> {formatDateTime(item.completed_at)}</p>
                  </div>
                  <div className={styles.actions}>
                    {item.payment_status === "unpaid" ? (
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        onClick={() => setConfirmPaymentId(item.id)}
                      >
                        Thanh toán
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {confirmPaymentId ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Xác nhận thanh toán</h3>
            <p>Bạn muốn xác nhận thanh toán?</p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setConfirmPaymentId(null)}
                disabled={confirmingPayment}
              >
                Hủy
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => confirmPayment(confirmPaymentId)}
                disabled={confirmingPayment}
              >
                {confirmingPayment ? "Đang xử lý..." : "Xác nhận thanh toán"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
