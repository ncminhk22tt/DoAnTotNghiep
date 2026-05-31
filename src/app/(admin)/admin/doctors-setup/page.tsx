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
  specialty_ids: number[];
  specialty_names: string[];
  username: string;
  full_name: string;
  total_services: number;
  service_ids: number[];
};

function doctorDisplayName(fullName: string, doctorCode?: string | null) {
  return `${fullName} - ${doctorCode && doctorCode.trim() ? doctorCode : "Chưa có mã"}`;
}

function uniquePositiveIds(values: number[]) {
  return Array.from(new Set(values.filter((id) => Number.isInteger(id) && id > 0)));
}

export default function AdminDoctorsSetupPage() {
  const { showToast } = useToast();
  const [doctorUsers, setDoctorUsers] = useState<DoctorUser[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [setups, setSetups] = useState<DoctorSetup[]>([]);

  const [userId, setUserId] = useState<number>(0);
  const [specialtyPickerId, setSpecialtyPickerId] = useState<number>(0);
  const [specialtyIds, setSpecialtyIds] = useState<number[]>([]);
  const [serviceIds, setServiceIds] = useState<number[]>([]);
  const [editingDoctorId, setEditingDoctorId] = useState<number | null>(null);
  const [detailDoctorId, setDetailDoctorId] = useState<number | null>(null);
  const [confirmActionOpen, setConfirmActionOpen] = useState(false);

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

  const lockedSpecialty = useMemo(() => {
    if (!userId) return null;
    const asHead = specialties.find((s) => s.head_doctor_user_id === userId) || null;
    if (asHead) return asHead;
    return specialties.find((s) => s.deputy_doctor_user_id === userId) || null;
  }, [specialties, userId]);

  const selectedSpecialties = useMemo(
    () => specialties.filter((s) => specialtyIds.includes(s.id)),
    [specialties, specialtyIds]
  );

  const serviceGroups = useMemo(() => {
    return selectedSpecialties
      .map((specialty) => ({
        specialty,
        items: services.filter((service) => service.specialty_id === specialty.id),
      }))
      .filter((group) => group.items.length > 0 || specialtyIds.includes(group.specialty.id));
  }, [selectedSpecialties, services, specialtyIds]);

  const detailRow = useMemo(
    () => setups.find((x) => x.doctor_id === detailDoctorId) || null,
    [setups, detailDoctorId]
  );

  const detailServices = useMemo(() => {
    if (!detailRow) return [];
    const mapById = new Map(services.map((service) => [service.id, service]));
    return detailRow.service_ids
      .map((id) => mapById.get(id))
      .filter((item): item is Service => !!item);
  }, [detailRow, services]);

  const detailServiceRows = useMemo(() => {
    if (!detailRow) return [];

    const specialtyItems =
      detailRow.specialty_ids.length > 0
        ? detailRow.specialty_ids.map((specialtyId, index) => ({
            id: specialtyId,
            name:
              detailRow.specialty_names[index] ||
              specialties.find((item) => item.id === specialtyId)?.name ||
              "-",
          }))
        : detailRow.specialty_name
          ? [
              {
                id: detailRow.specialty_id || 0,
                name: detailRow.specialty_name,
              },
            ]
          : [];

    if (specialtyItems.length === 0) return [];

    const rows: Array<{ serviceName: string; specialtyName: string }> = [];

    specialtyItems.forEach((specialty) => {
      const matchedServices = detailServices.filter((service) => service.specialty_id === specialty.id);

      if (matchedServices.length === 0) {
        rows.push({ serviceName: "(Chưa có dịch vụ)", specialtyName: specialty.name });
        return;
      }

      matchedServices.forEach((service) => {
        rows.push({ serviceName: service.name, specialtyName: specialty.name });
      });
    });

    return rows;
  }, [detailRow, detailServices, specialties]);

  function getSetupByUserId(doctorUserId: number) {
    return setups.find((setup) => setup.user_id === doctorUserId) || null;
  }

  const currentSetup = useMemo(
    () => (userId ? setups.find((setup) => setup.user_id === userId) || null : null),
    [userId, setups]
  );

  function resolveSpecialtyIdsFromSetup(setup: DoctorSetup) {
    const specialtyIdsFromServices = setup.service_ids
      .map((serviceId) => services.find((service) => service.id === serviceId)?.specialty_id)
      .filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0);

    return uniquePositiveIds([
      ...(setup.specialty_ids.length > 0
        ? setup.specialty_ids
        : setup.specialty_id
          ? [setup.specialty_id]
          : []),
      ...specialtyIdsFromServices,
    ]);
  }

  function syncServiceIds(nextSpecialtyIds: number[]) {
    const presetServiceIds = currentSetup
      ? currentSetup.service_ids.filter((serviceId) => {
          const service = services.find((item) => item.id === serviceId);
          return !!service && nextSpecialtyIds.includes(service.specialty_id);
        })
      : [];

    setServiceIds((current) =>
      uniquePositiveIds([
        ...current.filter((serviceId) => {
          const service = services.find((item) => item.id === serviceId);
          return !!service && nextSpecialtyIds.includes(service.specialty_id);
        }),
        ...presetServiceIds,
      ])
    );
  }

  function toggleSpecialty(specialtyId: number) {
    if (lockedSpecialty?.id === specialtyId) return;

    const next = specialtyIds.includes(specialtyId)
      ? specialtyIds.filter((id) => id !== specialtyId)
      : [...specialtyIds, specialtyId];

    setSpecialtyIds(uniquePositiveIds(next));
    syncServiceIds(uniquePositiveIds(next));
  }

  function handleSpecialtyPickerChange(nextSpecialtyId: number) {
    if (!nextSpecialtyId) return;
    toggleSpecialty(nextSpecialtyId);
    setSpecialtyPickerId(0);
  }

  function toggleService(serviceId: number) {
    setServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    );
  }

  function handleUserChange(nextUserId: number) {
    setUserId(nextUserId);
    setSpecialtyPickerId(0);
    const existingSetup = nextUserId ? getSetupByUserId(nextUserId) : null;

    if (existingSetup) {
      setSpecialtyIds(resolveSpecialtyIdsFromSetup(existingSetup));
      setServiceIds(uniquePositiveIds(existingSetup.service_ids || []));
      return;
    }

    setSpecialtyIds([]);
    setServiceIds([]);
  }

  function resetForm() {
    setEditingDoctorId(null);
    setUserId(0);
    setSpecialtyPickerId(0);
    setSpecialtyIds([]);
    setServiceIds([]);
    setConfirmActionOpen(false);
  }

  function beginEdit(row: DoctorSetup) {
    setEditingDoctorId(row.doctor_id);
    setUserId(row.user_id);
    setSpecialtyIds(resolveSpecialtyIdsFromSetup(row));
    setServiceIds(uniquePositiveIds(row.service_ids || []));
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  useEffect(() => {
    if (!lockedSpecialty) return;
    setSpecialtyIds((prev) =>
      prev.includes(lockedSpecialty.id) ? prev : uniquePositiveIds([lockedSpecialty.id, ...prev])
    );
  }, [lockedSpecialty]);

  useEffect(() => {
    syncServiceIds(specialtyIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialtyIds]);

  async function createSetup() {
    const validSpecialtyIds = uniquePositiveIds([
      ...(lockedSpecialty ? [lockedSpecialty.id] : []),
      ...specialtyIds,
    ]);
    const validServiceIds = serviceIds.filter((serviceId) => {
      const service = services.find((item) => item.id === serviceId);
      return !!service && validSpecialtyIds.includes(service.specialty_id);
    });

    if (!userId || validSpecialtyIds.length === 0 || validServiceIds.length === 0) {
      showToast("Vui lòng chọn bác sĩ, ít nhất 1 chuyên khoa và 1 dịch vụ", "error");
      return false;
    }

    const token = getAccessToken();
    await apiClient.post(
      "/api/admin/doctors/setup",
      { user_id: userId, specialty_ids: validSpecialtyIds, service_ids: validServiceIds },
      token
    );
    return true;
  }

  async function updateSetup(doctorId: number) {
    const validSpecialtyIds = uniquePositiveIds([
      ...(lockedSpecialty ? [lockedSpecialty.id] : []),
      ...specialtyIds,
    ]);
    const validServiceIds = serviceIds.filter((serviceId) => {
      const service = services.find((item) => item.id === serviceId);
      return !!service && validSpecialtyIds.includes(service.specialty_id);
    });

    if (validSpecialtyIds.length === 0 || validServiceIds.length === 0) {
      showToast("Vui lòng chọn ít nhất 1 chuyên khoa và 1 dịch vụ", "error");
      return false;
    }

    const token = getAccessToken();
    await apiClient.put(
      `/api/admin/doctors/setup/${doctorId}`,
      { specialty_ids: validSpecialtyIds, service_ids: validServiceIds },
      token
    );
    return true;
  }

  async function submitSetup() {
    try {
      if (editingDoctorId) {
        const updated = await updateSetup(editingDoctorId);
        if (!updated) return;
        showToast("Cập nhật thiết lập bác sĩ thành công", "success");
      } else {
        const created = await createSetup();
        if (!created) return;
        showToast("Tạo thiết lập bác sĩ thành công", "success");
      }
      resetForm();
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Lưu setup thất bại", "error");
    }
  }

  function openConfirmAction() {
    if (!userId) {
      showToast("Vui lòng chọn bác sĩ", "error");
      return;
    }
    if (specialtyIds.length === 0) {
      showToast("Vui lòng chọn ít nhất 1 chuyên khoa", "error");
      return;
    }
    if (serviceIds.length === 0) {
      showToast("Vui lòng chọn ít nhất 1 dịch vụ", "error");
      return;
    }
    setConfirmActionOpen(true);
  }

  useEffect(() => {
    loadAll().catch((err) =>
      showToast(err instanceof Error ? err.message : "Tải dữ liệu thất bại", "error")
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.page}>
      <section className={styles.formCard}>
        <h3 className={styles.subTitle}>
          {editingDoctorId ? "Cập nhật Thiết lập bác sĩ" : "Tạo thiết lập bác sĩ"}
        </h3>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Bác sĩ</label>
            <select
              value={userId}
              onChange={(e) => handleUserChange(Number(e.target.value))}
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
            <div className={styles.label}>Chuyên khoa</div>
            <select
              value={specialtyPickerId}
              onChange={(e) => handleSpecialtyPickerChange(Number(e.target.value))}
              className={`${styles.input} ${styles.selectInput}`}
              disabled={!userId}
            >
              <option value={0}>Chọn chuyên khoa</option>
              {specialties.map((specialty) => {
                const locked = lockedSpecialty?.id === specialty.id;
                const selected = specialtyIds.includes(specialty.id) || locked;
                return (
                  <option key={specialty.id} value={specialty.id} disabled={selected && !locked}>
                    {specialty.name}
                    {locked ? " (Khóa)" : selected ? " (Đã chọn)" : ""}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div>
          {/* <div className={styles.hintText}>Chọn chuyên khoa là tự thêm vào danh sách bên dưới.</div> */}
          <div className={styles.selectedSummary}>
            {specialtyIds.length > 0
              ? `Đã chọn ${specialtyIds.length} chuyên khoa: ${selectedSpecialties.map((item) => item.name).join(", ")}`
              : "Chưa chọn chuyên khoa nào."}
          </div>
          {specialtyIds.length > 0 ? (
            <div className={styles.chipList}>
              {selectedSpecialties.map((specialty) => {
                const locked = lockedSpecialty?.id === specialty.id;
                return (
                  <button
                    key={specialty.id}
                    type="button"
                    className={locked ? styles.specialtyChipLocked : styles.specialtyChip}
                    onClick={() => toggleSpecialty(specialty.id)}
                    disabled={!userId || locked}
                  >
                    {specialty.name}
                    {locked ? " (Khóa)" : " ×"}
                  </button>
                );
              })}
            </div>
          ) : null}
          {lockedSpecialty ? (
            <div className={styles.hintText}>
              Bác sĩ này là Trưởng/Phó khoa, chuyên khoa {lockedSpecialty.name}.
            </div>
          ) : null}
        </div>

        <div>
          <div className={styles.label}>Dịch vụ theo các chuyên khoa đã chọn</div>
          {selectedSpecialties.length === 0 ? (
            <div className={styles.hintText}>Chọn ít nhất 1 chuyên khoa để hiển thị danh sách dịch vụ.</div>
          ) : (
            <div className={styles.serviceGroups}>
              {serviceGroups.map((group) => (
                <div key={group.specialty.id} className={styles.serviceGroup}>
                  <div className={styles.groupTitle}>{group.specialty.name}</div>
                  <div className={styles.servicesGrid}>
                    {group.items.length === 0 ? (
                      <div className={styles.emptyServiceHint}>Chưa có dịch vụ trong khoa này.</div>
                    ) : (
                      group.items.map((service) => (
                        <label key={service.id} className={styles.serviceItem}>
                          <input
                            type="checkbox"
                            checked={serviceIds.includes(service.id)}
                            onChange={() => toggleService(service.id)}
                          />{" "}
                          {service.name}
                        </label>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.buttonRow}>
          <button className={styles.primaryBtn} type="button" onClick={openConfirmAction}>
            {editingDoctorId ? "Cập nhật thiết lập" : "Tạo thiết lập"}
          </button>
          <button className={styles.secondaryBtn} type="button" onClick={resetForm}>
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
                <td className={styles.td}>{row.specialty_ids.length}</td>
                <td className={styles.td}>{row.total_services}</td>
                <td className={`${styles.td} ${styles.actionCell}`}>
                  <div className={styles.actionGroup}>
                    <button className={styles.detailBtn} onClick={() => setDetailDoctorId(row.doctor_id)}>
                      Chi tiết
                    </button>
                    <button className={styles.editBtn} onClick={() => beginEdit(row)}>
                      Sửa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detailDoctorId && detailRow ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Chi tiết dịch vụ bác sĩ</h3>
            <p className={styles.modalText}>
              {doctorDisplayName(detailRow.full_name, detailRow.doctor_code)}
            </p>
            <p className={styles.modalText}>
              Chuyên khoa:{" "}
              {detailRow.specialty_names.length > 0
                ? detailRow.specialty_names.join(", ")
                : detailRow.specialty_name || "Chưa có chuyên khoa"}
            </p>

            <div className={styles.detailTableWrap}>
              <table className={styles.detailTable}>
                <thead>
                  <tr>
                    <th>Danh sách chuyên khoa</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRow.specialty_names.length === 0 ? (
                    <tr>
                      <td className={styles.emptyCell}>
                        Bác sĩ chưa được gán chuyên khoa nào.
                      </td>
                    </tr>
                  ) : (
                    detailRow.specialty_names.map((specialtyName) => (
                      <tr key={specialtyName}>
                        <td>{specialtyName}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className={styles.detailTableWrap}>
              <table className={styles.detailTable}>
                <thead>
                  <tr>
                    <th>Tên dịch vụ</th>
                    <th>Chuyên khoa</th>
                  </tr>
                </thead>
                <tbody>
                  {detailServiceRows.length === 0 ? (
                    <tr>
                      <td colSpan={2} className={styles.emptyCell}>
                        Bác sĩ chưa có chuyên khoa hoặc dịch vụ nào.
                      </td>
                    </tr>
                  ) : (
                    detailServiceRows.map((row, index) => (
                      <tr key={`${row.specialtyName}-${row.serviceName}-${index}`}>
                        <td>{row.serviceName}</td>
                        <td>{row.specialtyName}</td>
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

      {confirmActionOpen ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>
              {editingDoctorId ? "Xác nhận cập nhật" : "Xác nhận tạo"}
            </h3>
            <p className={styles.modalText}>
              {editingDoctorId
                ? "Bạn chắc chắn muốn cập nhật thiết lập bác sĩ này?"
                : "Bạn chắc chắn muốn tạo thiết lập bác sĩ này?"}
            </p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} type="button" onClick={() => setConfirmActionOpen(false)}>
                Hủy
              </button>
              <button
                className={styles.dangerBtn}
                type="button"
                onClick={async () => {
                  setConfirmActionOpen(false);
                  await submitSetup();
                }}
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
