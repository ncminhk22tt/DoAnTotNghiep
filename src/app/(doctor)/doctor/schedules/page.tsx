"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./schedules.module.css";

type SlotStatus = "available" | "full" | "closed";

type DoctorService = {
  id: number;
  name: string;
  specialty_id: number | null;
  specialty_name: string | null;
  description: string | null;
};

type ScheduleSlot = {
  id: number;
  doctor_id: number;
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

type CreateScheduleBody = {
  work_date: string;
  start_time: string;
  end_time: string;
  slot_duration: number;
  service_id: number;
  price: number;
  room?: string;
  max_patients?: number;
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

type TimeRangeOption = {
  start: string;
  end: string;
  startMinutes: number;
  endMinutes: number;
  label: string;
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

function minutesToHHMM(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (totalMinutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

const GROUP_THEME_COLORS = [
  { bg: "#f0f9ff", border: "#0ea5e9" },
  { bg: "#f0fdf4", border: "#22c55e" },
  { bg: "#fff7ed", border: "#f97316" },
  { bg: "#fdf4ff", border: "#c026d3" },
  { bg: "#fefce8", border: "#ca8a04" },
  { bg: "#eef2ff", border: "#6366f1" },
];

export default function DoctorSchedulesPage() {
  const { showToast } = useToast();
  const [services, setServices] = useState<DoctorService[]>([]);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [bulkTargetSlots, setBulkTargetSlots] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "bulk">("create");
  const [lockingSlotId, setLockingSlotId] = useState<number | null>(null);

  const [workDate, setWorkDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("11:00");
  const [slotDurationInput, setSlotDurationInput] = useState("30");
  const [serviceId, setServiceId] = useState(0);
  const [priceInput, setPriceInput] = useState("0");
  const [room, setRoom] = useState("");
  const [maxPatientsInput, setMaxPatientsInput] = useState("1");

  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SlotStatus>("all");
  const [serviceFilter, setServiceFilter] = useState<number>(0);
  const [bulkServiceId, setBulkServiceId] = useState(0);
  const [bulkWorkDate, setBulkWorkDate] = useState("");
  const [bulkRangeValue, setBulkRangeValue] = useState("all");
  const [bulkUpdateServiceId, setBulkUpdateServiceId] = useState(0);
  const [bulkUpdateWorkDate, setBulkUpdateWorkDate] = useState("");
  const [bulkPriceInput, setBulkPriceInput] = useState("0");
  const [bulkMaxPatientsInput, setBulkMaxPatientsInput] = useState("1");
  const [bulkRoom, setBulkRoom] = useState("");
  const [bulkStatus, setBulkStatus] = useState<"auto" | SlotStatus>("auto");
  const [bulkSaving, setBulkSaving] = useState(false);

  const [editingSlot, setEditingSlot] = useState<ScheduleSlot | null>(null);
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
    if (data.length > 0 && serviceId === 0) {
      setServiceId(data[0].id);
      setServiceFilter(data[0].id);
      setBulkServiceId(data[0].id);
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
      showToast(error instanceof Error ? error.message : "Khong the tai lich kham", "error");
    } finally {
      setLoading(false);
    }
  }

  async function loadBulkTargetSlots() {
    if (!bulkServiceId || !bulkWorkDate) {
      setBulkTargetSlots([]);
      return;
    }
    try {
      const token = getAccessToken();
      const params = new URLSearchParams();
      params.set("date", bulkWorkDate);
      params.set("service_id", String(bulkServiceId));
      const res = await apiClient.get<{ data: ScheduleSlot[] }>(
        `/api/doctor/schedules?${params.toString()}`,
        token
      );
      setBulkTargetSlots(res.data || []);
    } catch {
      setBulkTargetSlots([]);
    }
  }

  async function createSchedule() {
    const slotDuration = Number(slotDurationInput);
    const price = Number(priceInput || "0");
    const maxPatients = Number(maxPatientsInput);

    if (!workDate || !startTime || !endTime || !Number.isInteger(slotDuration) || slotDuration <= 0 || serviceId <= 0) {
      showToast("Vui long nhap du thong tin tao lich kham", "error");
      return;
    }
    if (!Number.isInteger(maxPatients) || maxPatients <= 0) {
      showToast("So luong benh nhan phai la so nguyen duong", "error");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      showToast("Gia kham khong hop le", "error");
      return;
    }

    const payload: CreateScheduleBody = {
      work_date: workDate,
      start_time: `${startTime}:00`,
      end_time: `${endTime}:00`,
      slot_duration: slotDuration,
      service_id: serviceId,
      price,
      room: room.trim() || undefined,
      max_patients: maxPatients,
    };

    try {
      setSaving(true);
      const token = getAccessToken();
      await apiClient.post("/api/doctor/schedules", payload, token);
      showToast("Tao lich kham thanh cong", "success");
      await loadSlots();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the tao lich kham", "error");
    } finally {
      setSaving(false);
    }
  }

  async function updateSlot() {
    if (!editingSlot) return;
    const nextPrice = Number(editPriceInput || "0");
    const nextMaxPatients = Number(editMaxPatientsInput);

    if (!Number.isInteger(nextMaxPatients) || nextMaxPatients <= 0) {
      showToast("So luong benh nhan phai la so nguyen duong", "error");
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
      showToast("Cap nhat slot thanh cong", "success");
      setEditingSlot(null);
      await loadSlots();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the cap nhat slot", "error");
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
      const message = error instanceof Error ? error.message : "Khong the cap nhat trang thai lich";
      if (message.includes("Trung gio da ton tai")) {
        showToast("Ban thao tac qua nhanh, vui long bam lai sau 1 giay.", "error");
        await loadSlots();
      } else {
        showToast(message, "error");
      }
    } finally {
      setLockingSlotId(null);
    }
  }

  async function deleteSlot(slotId: number) {
    try {
      const token = getAccessToken();
      await apiClient.delete(`/api/doctor/schedules/${slotId}`, token);
      showToast("Xóa slot thành công", "success");
      await loadSlots();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the xoa slot", "error");
    }
  }

  async function bulkUpdateByService() {
    const nextPrice = Number(bulkPriceInput || "0");
    const nextMaxPatients = Number(bulkMaxPatientsInput);

    if (bulkServiceId <= 0) {
      showToast("Vui long chon dich vu can cap nhat hang loat", "error");
      return;
    }
    if (!bulkWorkDate) {
      showToast("Vui long chon ngay can cap nhat", "error");
      return;
    }
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      showToast("Gia kham khong hop le", "error");
      return;
    }
    if (!Number.isInteger(nextMaxPatients) || nextMaxPatients <= 0) {
      showToast("So benh nhan toi da phai la so nguyen duong", "error");
      return;
    }

    try {
      const selectedRange = bulkRangeValue === "all" ? null : bulkRangeValue.split("|");
      const selectedStart = selectedRange?.[0] ?? null;
      const selectedEnd = selectedRange?.[1] ?? null;

      setBulkSaving(true);
      const token = getAccessToken();
      await apiClient.patch(
        "/api/doctor/schedules/bulk",
        {
          service_id: bulkServiceId,
          work_date: bulkWorkDate,
          start_time: selectedStart ?? undefined,
          end_time: selectedEnd ?? undefined,
          update_service_id: bulkUpdateServiceId > 0 ? bulkUpdateServiceId : undefined,
          update_work_date: bulkUpdateWorkDate || undefined,
          price: nextPrice,
          max_patients: nextMaxPatients,
          room: bulkRoom,
          status: bulkStatus === "auto" ? undefined : bulkStatus,
        },
        token
      );
      showToast("Cap nhat hang loat thanh cong", "success");
      await loadSlots();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Khong the cap nhat hang loat", "error");
    } finally {
      setBulkSaving(false);
    }
  }

  useEffect(() => {
    Promise.all([loadServices(), loadSlots()]).catch((error) => {
      showToast(error instanceof Error ? error.message : "Khong the tai du lieu lich kham", "error");
    });
  }, []);

  useEffect(() => {
    loadSlots();
  }, [dateFilter, statusFilter, serviceFilter]);

  useEffect(() => {
    setBulkRangeValue("all");
  }, [bulkServiceId, bulkWorkDate]);

  useEffect(() => {
    loadBulkTargetSlots();
  }, [bulkServiceId, bulkWorkDate]);

  const serviceNameById = useMemo(() => {
    const map = new Map<number, string>();
    services.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [services]);

  const bulkRangeOptions = useMemo<TimeRangeOption[]>(() => {
    if (!bulkServiceId || !bulkWorkDate) return [];
    const daySlots = bulkTargetSlots
      .filter((slot) => slot.service_id === bulkServiceId && toDateOnly(slot.work_date) === bulkWorkDate)
      .map((slot) => ({
        startMinutes: timeToMinutes(slot.start_time),
        endMinutes: timeToMinutes(slot.end_time),
      }))
      .filter((slot) => Number.isFinite(slot.startMinutes) && Number.isFinite(slot.endMinutes))
      .sort((a, b) => a.startMinutes - b.startMinutes);

    if (daySlots.length === 0) return [];

    const ranges: TimeRangeOption[] = [];
    let currentStartMinutes = daySlots[0].startMinutes;
    let currentEndMinutes = daySlots[0].endMinutes;

    for (let i = 1; i < daySlots.length; i += 1) {
      const startMinutes = daySlots[i].startMinutes;
      const endMinutes = daySlots[i].endMinutes;

      if (startMinutes === currentEndMinutes) {
        currentEndMinutes = endMinutes;
      } else {
        const start = minutesToHHMM(currentStartMinutes);
        const end = minutesToHHMM(currentEndMinutes);
        ranges.push({
          start,
          end,
          startMinutes: currentStartMinutes,
          endMinutes: currentEndMinutes,
          label: `${start} - ${end}`,
        });
        currentStartMinutes = startMinutes;
        currentEndMinutes = endMinutes;
      }
    }

    const start = minutesToHHMM(currentStartMinutes);
    const end = minutesToHHMM(currentEndMinutes);
    ranges.push({
      start,
      end,
      startMinutes: currentStartMinutes,
      endMinutes: currentEndMinutes,
      label: `${start} - ${end}`,
    });

    return ranges;
  }, [bulkTargetSlots, bulkServiceId, bulkWorkDate]);

  const bulkAffectedSlots = useMemo(() => {
    if (!bulkWorkDate || !bulkServiceId) return [];
    if (bulkRangeValue === "all") return bulkTargetSlots;
    const [start, end] = bulkRangeValue.split("|");
    if (!start || !end) return [];
    return bulkTargetSlots.filter(
      (slot) => toHHMM(slot.start_time) >= start && toHHMM(slot.end_time) <= end
    );
  }, [bulkTargetSlots, bulkServiceId, bulkWorkDate, bulkRangeValue]);

  useEffect(() => {
    if (bulkAffectedSlots.length === 0) return;
    const first = bulkAffectedSlots[0];
    setBulkPriceInput(String(Math.floor(Number(first.price || 0))));
    setBulkMaxPatientsInput(String(Number(first.max_patients || 1)));
    setBulkRoom(first.room || "");
    setBulkStatus(first.status ?? "auto");
    setBulkUpdateServiceId(Number(first.service_id || 0));
    setBulkUpdateWorkDate(toDateOnly(first.work_date));
  }, [bulkAffectedSlots]);

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
      <h2 className={styles.title}>Tao lich kham</h2>

      <div className={styles.modeSwitchWrap}>
        <button
          type="button"
          className={`${styles.modeBtn} ${formMode === "create" ? styles.modeBtnActive : ""}`}
          onClick={() => setFormMode("create")}
        >
          Tao lich kham
        </button>
        <button
          type="button"
          className={`${styles.modeBtn} ${formMode === "bulk" ? styles.modeBtnActive : ""}`}
          onClick={() => setFormMode("bulk")}
        >
          Cap nhat hang loat
        </button>
      </div>

      {formMode === "create" ? (
      <section className={styles.formCard}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Ngay lam viec</label>
            <input type="date" className={styles.input} value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Dich vu</label>
            <select
              className={`${styles.input} ${styles.selectInput}`}
              value={serviceId}
              onChange={(e) => setServiceId(Number(e.target.value))}
            >
              <option value={0}>Chon dich vu</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.specialty_name ? `- ${s.specialty_name}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Gio bat dau</label>
            <input type="time" className={styles.input} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Gio ket thuc</label>
            <input type="time" className={styles.input} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Do dai slot (phut)</label>
            <input
              type="text"
              inputMode="numeric"
              className={styles.input}
              value={slotDurationInput}
              onChange={(e) => setSlotDurationInput(keepDigits(e.target.value))}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>So benh nhan toi da / slot</label>
            <input
              type="text"
              inputMode="numeric"
              className={styles.input}
              value={maxPatientsInput}
              onChange={(e) => setMaxPatientsInput(keepDigits(e.target.value))}
            />
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Phong kham</label>
            <input className={styles.input} placeholder="Vi du: P201" value={room} onChange={(e) => setRoom(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Gia kham</label>
            <input
              type="text"
              inputMode="numeric"
              className={styles.input}
              value={priceInput}
              onChange={(e) => setPriceInput(keepDigits(e.target.value))}
            />
          </div>
        </div>

        <div className={styles.buttonRow}>
          <button className={styles.primaryBtn} disabled={saving} onClick={createSchedule}>
            {saving ? "Dang tao..." : "Tao lich kham"}
          </button>
        </div>
      </section>
      ) : (
      <section className={styles.formCard}>
        <h3 className={styles.subTitle}>Cap nhat hang loat theo dich vu</h3>
        <div className={styles.bulkGrid}>
          <div className={`${styles.bulkCard} ${styles.bulkScopeCard}`}>
            <h4 className={styles.bulkCardTitle}>Loc pham vi ap dung</h4>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Dich vu can ap dung</label>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={bulkServiceId}
                  onChange={(e) => setBulkServiceId(Number(e.target.value))}
                >
                  <option value={0}>Chon dich vu</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Ngay ap dung</label>
                <input
                  type="date"
                  className={styles.input}
                  value={bulkWorkDate}
                  onChange={(e) => setBulkWorkDate(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Ca ap dung</label>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={bulkRangeValue}
                  onChange={(e) => setBulkRangeValue(e.target.value)}
                  disabled={!bulkWorkDate || !bulkServiceId}
                >
                  <option value="all">Tat ca khung gio trong ngay</option>
                  {bulkRangeOptions.map((range) => (
                    <option key={`${range.start}-${range.end}`} value={`${range.start}|${range.end}`}>
                      {range.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className={`${styles.bulkCard} ${styles.bulkChangeCard}`}>
            <h4 className={styles.bulkCardTitle}>Thong tin muon thay doi</h4>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Dich vu moi (neu doi)</label>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={bulkUpdateServiceId}
                  onChange={(e) => setBulkUpdateServiceId(Number(e.target.value))}
                >
                  <option value={0}>Giu nguyen dich vu</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Ngay moi (neu doi)</label>
                <input
                  type="date"
                  className={styles.input}
                  value={bulkUpdateWorkDate}
                  onChange={(e) => setBulkUpdateWorkDate(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Gia kham moi</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={styles.input}
                  value={bulkPriceInput}
                  onChange={(e) => setBulkPriceInput(keepDigits(e.target.value))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>So benh nhan toi da moi</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={styles.input}
                  value={bulkMaxPatientsInput}
                  onChange={(e) => setBulkMaxPatientsInput(keepDigits(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Phong kham moi</label>
                <input
                  className={styles.input}
                  value={bulkRoom}
                  onChange={(e) => setBulkRoom(e.target.value)}
                  placeholder="De trong neu muon bo phong"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Trang thai sau cap nhat</label>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value as "auto" | SlotStatus)}
                >
                  <option value="auto">Tu dong theo so da dat</option>
                  <option value="available">Con cho</option>
                  <option value="full">Da day</option>
                  <option value="closed">Dong</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.buttonRow}>
          <button className={styles.primaryBtn} disabled={bulkSaving} onClick={bulkUpdateByService}>
            {bulkSaving ? "Dang cap nhat..." : "Cap nhat tat ca slot cua dich vu"}
          </button>
        </div>
      </section>
      )}

      <div className={styles.listContainer} style={{ display: "none" }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Dich vu</th>
              <th className={styles.th}>Ngày</th>
              <th className={styles.th}>Gio</th>
              <th className={styles.th}>Phong</th>
              <th className={styles.th}>Giá khám</th>
              <th className={styles.th}>Suc chua</th>
              <th className={styles.th}>Trang thai</th>
              <th className={`${styles.th} ${styles.actionHeader}`}>Thao tác</th>
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
                  <td className={styles.td}>{slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}</td>
                  <td className={styles.td}>{slot.room || "-"}</td>
                  <td className={styles.td}>{Number(slot.price || 0).toLocaleString("vi-VN")} đ</td>
                  <td className={styles.td}>{slot.booked_count}/{slot.max_patients}</td>
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
                      <button className={styles.editBtn} onClick={() => openEditSlot(slot)}>Sua</button>
                      <button className={styles.dangerBtn} onClick={() => deleteSlot(slot.id)}>Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          )})}
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

      {editingSlot ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Sua slot lich kham</h3>
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
                <label className={styles.label}>Ngày</label>
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
                <label className={styles.label}>Giá khám</label>
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








