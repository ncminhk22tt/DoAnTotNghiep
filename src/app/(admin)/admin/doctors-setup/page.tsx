"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./doctors-setup.module.css";

type DoctorUser = {
  id: number;
  username: string;
  full_name: string;
  status: string;
  doctor_code?: string | null;
};

type Specialty = {
  id: number;
  name: string;
  head_doctor_user_id?: number | null;
  deputy_doctor_user_id?: number | null;
};

type Service = {
  id: number;
  name: string;
  specialty_id: number;
};

type DoctorSetup = {
  doctor_id: number;
  user_id: number;
  doctor_code: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
  username: string;
  full_name: string;
  total_services: number;
  service_ids: number[];
};

function doctorDisplayName(fullName: string, doctorCode?: string | null) {
  return `${fullName} - ${doctorCode && doctorCode.trim() ? doctorCode : "Chưa có mã"}`;
}

export default function AdminDoctorsSetupPage() {
  const { showToast } = useToast();
  const [doctorUsers, setDoctorUsers] = useState<DoctorUser[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [setups, setSetups] = useState<DoctorSetup[]>([]);

  const [userId, setUserId] = useState<number>(0);
  const [specialtyId, setSpecialtyId] = useState<number>(0);
  const [serviceIds, setServiceIds] = useState<number[]>([]);
  const [editingDoctorId, setEditingDoctorId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [detailDoctorId, setDetailDoctorId] = useState<number | null>(null);

  async function loadAll() {
    const token = getAccessToken();
    const [doctorUsersRes, specialtiesRes, servicesRes, setupRes] = await Promise.all([
      apiClient.get<{ data: DoctorUser[] }>("/api/admin/doctors/users", token),
      apiClient.get<{ data: Specialty[] }>("/api/admin/specialties", token),
      apiClient.get<{ data: Service[] }>("/api/admin/services", token),
      apiClient.get<{ data: DoctorSetup[] }>("/api/admin/doctors/setup", token),
    ]);

    setDoctorUsers(doctorUsersRes.data || []);
    setSpecialties(specialtiesRes.data || []);
    setServices(servicesRes.data || []);
    setSetups(setupRes.data || []);
  }

  const filteredServices = useMemo(
    () => services.filter((s) => s.specialty_id === specialtyId),
    [services, specialtyId]
  );

  const lockedSpecialty = useMemo(() => {
    if (!userId) return null;
    const asHead = specialties.find((s) => s.head_doctor_user_id === userId) || null;
    if (asHead) return asHead;
    return specialties.find((s) => s.deputy_doctor_user_id === userId) || null;
  }, [specialties, userId]);

  const isSpecialtyLocked = !!lockedSpecialty;

  function toggleService(serviceId: number) {
    setServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((x) => x !== serviceId) : [...prev, serviceId]
    );
  }

  function resetForm() {
    setEditingDoctorId(null);
    setUserId(0);
    setSpecialtyId(0);
    setServiceIds([]);
  }

  function changeSpecialty(nextSpecialtyId: number) {
    setSpecialtyId(nextSpecialtyId);
    setServiceIds([]);
  }

  function beginEdit(row: DoctorSetup) {
    setEditingDoctorId(row.doctor_id);
    setUserId(row.user_id);
    setSpecialtyId(row.specialty_id || 0);
    setServiceIds(row.service_ids || []);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const detailRow = useMemo(
    () => setups.find((x) => x.doctor_id === detailDoctorId) || null,
    [setups, detailDoctorId]
  );

  const detailServices = useMemo(() => {
    if (!detailRow) return [];
    const mapById = new Map(services.map((s) => [s.id, s]));
    return detailRow.service_ids
      .map((id) => mapById.get(id))
      .filter((x): x is Service => !!x);
  }, [detailRow, services]);

  useEffect(() => {
    if (!lockedSpecialty) return;
    if (specialtyId !== lockedSpecialty.id) {
      setSpecialtyId(lockedSpecialty.id);
      setServiceIds([]);
    }
  }, [lockedSpecialty, specialtyId]);

  async function createSetup() {
    const validServiceIds = serviceIds.filter((sid) =>
      services.some((s) => s.id === sid && s.specialty_id === specialtyId)
    );

    if (!userId || !specialtyId || validServiceIds.length === 0) {
      showToast("Vui lòng chọn bác sĩ, chuyên khoa và ít nhất 1 dịch vụ", "error");
      return;
    }

    const token = getAccessToken();
    await apiClient.post(
      "/api/admin/doctors/setup",
      { user_id: userId, specialty_id: specialtyId, service_ids: validServiceIds },
      token
    );
  }

  async function updateSetup(doctorId: number) {
    const validServiceIds = serviceIds.filter((sid) =>
      services.some((s) => s.id === sid && s.specialty_id === specialtyId)
    );

    if (!specialtyId || validServiceIds.length === 0) {
      showToast("Vui lòng chọn chuyên khoa và dịch vụ trước khi sửa", "error");
      return;
    }

    const token = getAccessToken();
    await apiClient.put(
      `/api/admin/doctors/setup/${doctorId}`,
      { specialty_id: specialtyId, service_ids: validServiceIds },
      token
    );
  }

  async function submitSetup() {
    try {
      if (editingDoctorId) {
        await updateSetup(editingDoctorId);
        showToast("Cập nhật setup bác sĩ thành công", "success");
      } else {
        await createSetup();
        showToast("Tạo setup bác sĩ thành công", "success");
      }
      resetForm();
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Lưu setup thất bại", "error");
    }
  }

  async function onDeleteConfirmed() {
    if (!confirmDeleteId) return;
    try {
      const token = getAccessToken();
      await apiClient.delete(`/api/admin/doctors/setup/${confirmDeleteId}`, token);
      setConfirmDeleteId(null);
      await loadAll();
      showToast("Xóa setup bác sĩ thành công", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Xóa thất bại", "error");
    }
  }

  useEffect(() => {
    loadAll().catch((err) =>
      showToast(err instanceof Error ? err.message : "Tải dữ liệu thất bại", "error")
    );
  }, []);

  return (
    <div className={styles.page}>
      {/* <h2 className={styles.title}>Setup bác sĩ</h2> */}

      <section className={styles.formCard}>
        <h3 className={styles.subTitle}>
          {editingDoctorId ? "Cập nhật setup bác sĩ" : "Tạo setup bác sĩ"}
        </h3>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Bác sĩ</label>
            <select
              value={userId}
              onChange={(e) => setUserId(Number(e.target.value))}
              className={`${styles.input} ${styles.selectInput}`}
            >
              <option value={0}>Chọn bác sĩ</option>
              {doctorUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {doctorDisplayName(u.full_name, u.doctor_code)}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Chuyên khoa</label>
            <select
              value={specialtyId}
              onChange={(e) => changeSpecialty(Number(e.target.value))}
              className={`${styles.input} ${styles.selectInput}`}
              disabled={isSpecialtyLocked}
            >
              <option value={0}>Chọn chuyên khoa</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {lockedSpecialty ? (
              <div className={styles.hintText}>
                Bác sĩ này là Trưởng/Phó khoa, chuyên khoa được khóa theo: {lockedSpecialty.name}
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <div className={styles.label}>Danh sách dịch vụ theo chuyên khoa</div>
          <div className={styles.servicesGrid}>
            {filteredServices.map((s) => (
              <label key={s.id} className={styles.serviceItem}>
                <input
                  type="checkbox"
                  checked={serviceIds.includes(s.id)}
                  onChange={() => toggleService(s.id)}
                />{" "}
                {s.name}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.buttonRow}>
          <button className={styles.primaryBtn} onClick={submitSetup}>
            {editingDoctorId ? "Cập nhật setup" : "Tạo setup"}
          </button>
          <button className={styles.secondaryBtn} onClick={resetForm}>
            Làm mới
          </button>
        </div>
      </section>

      <div className={styles.listContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Mã bác sĩ</th>
              <th className={styles.th}>Bác sĩ</th>
              <th className={styles.th}>Chuyên khoa</th>
              <th className={styles.th}>Số dịch vụ</th>
              <th className={`${styles.th} ${styles.actionHeader}`}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {setups.map((row) => (
              <tr key={row.doctor_id}>
                <td className={styles.td}>{row.doctor_code || "-"}</td>
                <td className={styles.td}>{doctorDisplayName(row.full_name, row.doctor_code)}</td>
                <td className={styles.td}>{row.specialty_name || "-"}</td>
                <td className={styles.td}>{row.total_services}</td>
                <td className={`${styles.td} ${styles.actionCell}`}>
                  <div className={styles.actionGroup}>
                    <button className={styles.detailBtn} onClick={() => setDetailDoctorId(row.doctor_id)}>
                      Chi tiết
                    </button>
                    <button className={styles.editBtn} onClick={() => beginEdit(row)}>
                      Sửa
                    </button>
                    <button className={styles.deleteBtn} onClick={() => setConfirmDeleteId(row.doctor_id)}>
                      Xóa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmDeleteId ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Xác nhận xóa</h3>
            <p className={styles.modalText}>Bạn có chắc chắn muốn xóa setup bác sĩ này không?</p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setConfirmDeleteId(null)}>
                Hủy
              </button>
              <button className={styles.dangerBtn} onClick={onDeleteConfirmed}>
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailDoctorId && detailRow ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Chi tiết dịch vụ bác sĩ</h3>
            <p className={styles.modalText}>
              {doctorDisplayName(detailRow.full_name, detailRow.doctor_code)} - {detailRow.specialty_name || "Chưa có chuyên khoa"}
            </p>

            <div className={styles.detailTableWrap}>
              <table className={styles.detailTable}>
                <thead>
                  <tr>
                    <th>Tên dịch vụ</th>
                    <th>Chuyên khoa</th>
                  </tr>
                </thead>
                <tbody>
                  {detailServices.length === 0 ? (
                    <tr>
                      <td colSpan={2} className={styles.emptyCell}>
                        Bác sĩ chưa có dịch vụ nào.
                      </td>
                    </tr>
                  ) : (
                    detailServices.map((service) => (
                      <tr key={service.id}>
                        <td>{service.name}</td>
                        <td>{specialties.find((x) => x.id === service.specialty_id)?.name || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setDetailDoctorId(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
