"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./schedules.module.css";

type SlotStatus = "available" | "full" | "closed";

type DoctorService = {
  id: number;
  name: string;
};

type ScheduleSlot = {
  id: number;
  service_id: number;
  work_date: string;
  start_time: string;
  end_time: string;
  room: string | null;
  price: number;
  max_patients: number;
  booked_count: number;
  status: SlotStatus;
};

type UpdateScheduleBody = {
  service_id: number;
  work_date: string;
  start_time: string;
  end_time: string;
  room: string;
  price: number;
  max_patients: number;
  status: SlotStatus;
};

function statusLabel(status: SlotStatus) {
  if (status === "available") return "Con cho";
  if (status === "full") return "Da day";
  return "Dong";
}

function keepDigits(value: string) {
  return value.replace(/\D/g, "");
}

function toDateOnly(value: string | null | undefined) {
  if (!value) return "";
  if (value.includes("T")) return value.split("T")[0];
  if (value.includes(" ")) return value.split(" ")[0];
  return value.slice(0, 10);
}

function toHHMM(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value.slice(0, 5);
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function timeToMinutes(value: string) {
  const hhmm = toHHMM(value);
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Number.NaN;
  return h * 60 + m;
}

const GROUP_THEME_COLORS = [
  { bg: "#f0f9ff", border: "#0ea5e9" },
  { bg: "#f0fdf4", border: "#22c55e" },
  { bg: "#fff7ed", border: "#f97316" },
  { bg: "#fdf4ff", border: "#c026d3" },
  { bg: "#fefce8", border: "#ca8a04" },
  { bg: "#eef2ff", border: "#6366f1" },
];

export default function DoctorScheduleListPage() {
  const { showToast } = useToast();

  const [services, setServices] = useState<DoctorService[]>([]);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [lockingSlotId, setLockingSlotId] = useState<number | null>(null);

  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SlotStatus>("all");
  const [serviceFilter, setServiceFilter] = useState<number>(0);

  const [editingSlot, setEditingSlot] = useState<ScheduleSlot | null>(null);
  const [saving, setSaving] = useState(false);
  const [editPriceInput, setEditPriceInput] = useState("0");
  const [editMaxPatientsInput, setEditMaxPatientsInput] = useState("1");

  function openEditSlot(slot: ScheduleSlot) {
    setEditingSlot(slot);
    setEditPriceInput(String(slot.price ?? 0));
    setEditMaxPatientsInput(String(slot.max_patients ?? 1));
  }

  async function loadServices() {
    const token = getAccessToken();
    const res = await apiClient.get<{ data: DoctorService[] }>("/api/doctor/services", token);
    const data = res.data || [];
    setServices(data);
    if (data.length > 0 && serviceFilter === 0) {
      setServiceFilter(data[0].id);
    }
  }

  async function loadSlots() {
    setLoading(true);
    try {
      const token = getAccessToken();
      const params = new URLSearchParams();
      if (dateFilter) params.set("date", dateFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (serviceFilter > 0) params.set("service_id", String(serviceFilter));

      const qs = params.toString();
      const res = await apiClient.get<{ data: ScheduleSlot[] }>(
        `/api/doctor/schedules${qs ? `?${qs}` : ""}`,
        token
      );
      setSlots(res.data || []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the tai danh sach lich", "error");
    } finally {
      setLoading(false);
    }
  }

  async function updateSlot() {
    if (!editingSlot) return;

    const nextPrice = Number(editPriceInput || "0");
    const nextMaxPatients = Number(editMaxPatientsInput);

    if (!Number.isInteger(nextMaxPatients) || nextMaxPatients <= 0) {
      showToast("So benh nhan toi da phai la so nguyen duong", "error");
      return;
    }
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      showToast("Gia kham khong hop le", "error");
      return;
    }

    const payload: UpdateScheduleBody = {
      service_id: editingSlot.service_id,
      work_date: toDateOnly(editingSlot.work_date),
      start_time: editingSlot.start_time,
      end_time: editingSlot.end_time,
      room: editingSlot.room || "",
      price: nextPrice,
      max_patients: nextMaxPatients,
      status: editingSlot.status,
    };

    try {
      setSaving(true);
      const token = getAccessToken();
      await apiClient.put(`/api/doctor/schedules/${editingSlot.id}`, payload, token);
      showToast("Cap nhat lich thanh cong", "success");
      setEditingSlot(null);
      await loadSlots();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the cap nhat lich", "error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleLockSlot(slot: ScheduleSlot) {
    if (lockingSlotId === slot.id) return;

    const reopenStatus: SlotStatus = slot.booked_count >= slot.max_patients ? "full" : "available";
    const nextStatus: SlotStatus = slot.status === "closed" ? reopenStatus : "closed";

    const payload: UpdateScheduleBody = {
      service_id: slot.service_id,
      work_date: toDateOnly(slot.work_date),
      start_time: slot.start_time,
      end_time: slot.end_time,
      room: slot.room || "",
      price: Number(slot.price) || 0,
      max_patients: Number(slot.max_patients) || 1,
      status: nextStatus,
    };

    try {
      setLockingSlotId(slot.id);
      const token = getAccessToken();
      await apiClient.put(`/api/doctor/schedules/${slot.id}`, payload, token);
      showToast(nextStatus === "closed" ? "Da khoa lich" : "Da mo lich", "success");
      await loadSlots();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the cap nhat trang thai", "error");
    } finally {
      setLockingSlotId(null);
    }
  }

  async function deleteSlot(slotId: number) {
    try {
      const token = getAccessToken();
      await apiClient.delete(`/api/doctor/schedules/${slotId}`, token);
      showToast("Xoa lich thanh cong", "success");
      await loadSlots();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the xoa lich", "error");
    }
  }

  useEffect(() => {
    Promise.all([loadServices(), loadSlots()]).catch((error) => {
      showToast(error instanceof Error ? error.message : "Khong the tai du lieu", "error");
    });
  }, []);

  useEffect(() => {
    loadSlots();
  }, [dateFilter, statusFilter, serviceFilter]);

  const serviceNameById = useMemo(() => {
    const map = new Map<number, string>();
    services.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [services]);

  const groupedSlots = useMemo(() => {
    const ordered = [...slots].sort((a, b) => {
      const dateDiff = toDateOnly(a.work_date).localeCompare(toDateOnly(b.work_date));
      if (dateDiff !== 0) return dateDiff;
      if (a.service_id !== b.service_id) return a.service_id - b.service_id;
      return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
    });

    const groups: Array<{
      key: string;
      serviceId: number;
      workDate: string;
      start: string;
      end: string;
      slots: ScheduleSlot[];
    }> = [];

    for (const slot of ordered) {
      const workDate = toDateOnly(slot.work_date);
      const start = toHHMM(slot.start_time);
      const end = toHHMM(slot.end_time);
      const last = groups[groups.length - 1];

      if (
        last &&
        last.serviceId === slot.service_id &&
        last.workDate === workDate &&
        last.end === start
      ) {
        last.end = end;
        last.slots.push(slot);
      } else {
        groups.push({
          key: `${slot.service_id}-${workDate}-${start}`,
          serviceId: slot.service_id,
          workDate,
          start,
          end,
          slots: [slot],
        });
      }
    }

    return groups;
  }, [slots]);

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Danh sach lich kham</h2>
      <div className={styles.buttonRow}>
        <Link className={styles.secondaryBtn} href="/doctor/schedules">
          Quay lai trang tao lich
        </Link>
      </div>

      <div className={styles.contentGrid}>
        <aside className={styles.leftPanel}>
          <h3 className={styles.panelTitle}>Bo loc ben trai</h3>
          <div className={styles.field}>
            <label className={styles.label}>Chon dich vu</label>
            <select
              className={`${styles.input} ${styles.selectInput}`}
              value={serviceFilter}
              onChange={(e) => setServiceFilter(Number(e.target.value))}
            >
              <option value={0}>Tat ca dich vu</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </aside>

        <section className={styles.rightPanel}>
          <section className={styles.filterCard}>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Loc theo ngay</label>
                <input
                  type="date"
                  className={styles.input}
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Loc theo trang thai</label>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "all" | SlotStatus)}
                >
                  <option value="all">Tat ca</option>
                  <option value="available">Con cho</option>
                  <option value="full">Da day</option>
                  <option value="closed">Dong</option>
                </select>
              </div>
            </div>
          </section>

          <div className={styles.listContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Dich vu</th>
                  <th className={styles.th}>Ngay</th>
                  <th className={styles.th}>Gio</th>
                  <th className={styles.th}>Phong</th>
                  <th className={styles.th}>Gia kham</th>
                  <th className={styles.th}>Suc chua</th>
                  <th className={styles.th}>Trang thai</th>
                  <th className={`${styles.th} ${styles.actionHeader}`}>Thao tac</th>
                </tr>
              </thead>
              {groupedSlots.map((group, groupIndex) => {
                const theme = GROUP_THEME_COLORS[groupIndex % GROUP_THEME_COLORS.length];
                return (
                  <tbody
                    key={group.key}
                    className={styles.groupBody}
                    style={
                      {
                        ["--group-bg" as string]: theme.bg,
                        ["--group-border" as string]: theme.border,
                      } as Record<string, string>
                    }
                  >
                    {group.slots.map((slot) => (
                      <tr key={slot.id}>
                        <td className={styles.td}>{serviceNameById.get(slot.service_id) || `#${slot.service_id}`}</td>
                        <td className={styles.td}>{toDateOnly(slot.work_date)}</td>
                        <td className={styles.td}>
                          {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                        </td>
                        <td className={styles.td}>{slot.room || "-"}</td>
                        <td className={styles.td}>{Number(slot.price || 0).toLocaleString("vi-VN")} đ</td>
                        <td className={styles.td}>
                          {slot.booked_count}/{slot.max_patients}
                        </td>
                        <td className={styles.td}>
                          <span className={`${styles.statusBadge} ${styles[`status_${slot.status}`]}`}>
                            {statusLabel(slot.status)}
                          </span>
                        </td>
                        <td className={`${styles.td} ${styles.actionCell}`}>
                          <div className={styles.actionGroup}>
                            <button
                              className={styles.lockBtn}
                              onClick={() => toggleLockSlot(slot)}
                              disabled={lockingSlotId === slot.id}
                            >
                              {lockingSlotId === slot.id
                                ? "Dang xu ly..."
                                : slot.status === "closed"
                                  ? "Mo lich"
                                  : "Khoa lich"}
                            </button>
                            <button className={styles.editBtn} onClick={() => openEditSlot(slot)}>
                              Sua
                            </button>
                            <button className={styles.dangerBtn} onClick={() => deleteSlot(slot.id)}>
                              Xoa
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
              {!loading && groupedSlots.length === 0 ? (
                <tbody>
                  <tr>
                    <td className={styles.emptyCell} colSpan={8}>
                      Chua co lich kham nao.
                    </td>
                  </tr>
                </tbody>
              ) : null}
            </table>
          </div>
        </section>
      </div>

      {editingSlot ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Sua lich kham</h3>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Dich vu</label>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={editingSlot.service_id}
                  onChange={(e) => setEditingSlot({ ...editingSlot, service_id: Number(e.target.value) })}
                >
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Ngay</label>
                <input
                  type="date"
                  className={styles.input}
                  value={toDateOnly(editingSlot.work_date)}
                  onChange={(e) => setEditingSlot({ ...editingSlot, work_date: e.target.value })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Gio bat dau</label>
                <input
                  type="time"
                  className={styles.input}
                  value={editingSlot.start_time.slice(0, 5)}
                  onChange={(e) => setEditingSlot({ ...editingSlot, start_time: `${e.target.value}:00` })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Gio ket thuc</label>
                <input
                  type="time"
                  className={styles.input}
                  value={editingSlot.end_time.slice(0, 5)}
                  onChange={(e) => setEditingSlot({ ...editingSlot, end_time: `${e.target.value}:00` })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Phong</label>
                <input
                  className={styles.input}
                  value={editingSlot.room || ""}
                  onChange={(e) => setEditingSlot({ ...editingSlot, room: e.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Gia kham</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={styles.input}
                  value={editPriceInput}
                  onChange={(e) => setEditPriceInput(keepDigits(e.target.value))}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>So benh nhan toi da</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={styles.input}
                  value={editMaxPatientsInput}
                  onChange={(e) => setEditMaxPatientsInput(keepDigits(e.target.value))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Trang thai</label>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={editingSlot.status}
                  onChange={(e) => setEditingSlot({ ...editingSlot, status: e.target.value as SlotStatus })}
                >
                  <option value="available">Con cho</option>
                  <option value="full">Da day</option>
                  <option value="closed">Dong</option>
                </select>
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setEditingSlot(null)}>
                Huy
              </button>
              <button className={styles.primaryBtn} disabled={saving} onClick={updateSlot}>
                {saving ? "Dang luu..." : "Luu thay doi"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
