"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  service_name?: string | null;
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

type SlotGroup = {
  key: string;
  serviceId: number;
  workDate: string;
  start: string;
  end: string;
  slots: ScheduleSlot[];
};

function statusLabel(status: SlotStatus) {
  if (status === "available") return "Còn chỗ";
  if (status === "full") return "Đã đầy";
  return "Đóng";
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

function isPastDate(value: string, todayValue: string) {
  return value < todayValue;
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

function hourPart(value: string) {
  const [h] = toHHMM(value).split(":");
  return h || "00";
}

function minutePart(value: string) {
  const [, m] = toHHMM(value).split(":");
  return m === "30" ? m : "00";
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTE_OPTIONS = ["00", "30"];

export default function DoctorSchedulesPage() {
  const { showToast } = useToast();
  const [services, setServices] = useState<DoctorService[]>([]);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [bulkTargetSlots, setBulkTargetSlots] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "bulk" | "list">("create");
  const [lockingSlotId, setLockingSlotId] = useState<number | null>(null);

  const [workDate, setWorkDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("11:00");
  const [slotDurationInput, setSlotDurationInput] = useState("30");
  const [serviceId, setServiceId] = useState(0);
  const [priceInput, setPriceInput] = useState("");
  const [room, setRoom] = useState("");

  const [dateFilter, setDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SlotStatus>("all");
  const [serviceFilter, setServiceFilter] = useState<number>(0);
  const [bulkServiceId, setBulkServiceId] = useState(0);
  const [bulkWorkDate, setBulkWorkDate] = useState("");
  const [bulkRangeValue, setBulkRangeValue] = useState("all");
  const [bulkUpdateServiceId, setBulkUpdateServiceId] = useState(0);
  const [bulkUpdateWorkDate, setBulkUpdateWorkDate] = useState("");
  const [bulkUpdateStartTime, setBulkUpdateStartTime] = useState("");
  const [bulkUpdateEndTime, setBulkUpdateEndTime] = useState("");
  const [bulkSlotDurationInput, setBulkSlotDurationInput] = useState("30");
  const [bulkPriceInput, setBulkPriceInput] = useState("");
  const [bulkRoom, setBulkRoom] = useState("");
  const [bulkStatus, setBulkStatus] = useState<"auto" | SlotStatus>("auto");
  const [bulkSaving, setBulkSaving] = useState(false);

  const [editingSlot, setEditingSlot] = useState<ScheduleSlot | null>(null);
  const [confirmLockSlot, setConfirmLockSlot] = useState<ScheduleSlot | null>(null);
  const [editPriceInput, setEditPriceInput] = useState("0");
  const [editMaxPatientsInput, setEditMaxPatientsInput] = useState("1");

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const nowMinutes = useMemo(() => {
    const now = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    return timeToMinutes(now);
  }, []);
  const createStartOptions = useMemo(() => {
    const all = HOUR_OPTIONS.flatMap((h) => MINUTE_OPTIONS.map((m) => `${h}:${m}`));
    if (workDate !== today) return all;
    return all.filter((t) => timeToMinutes(t) > nowMinutes);
  }, [workDate, today, nowMinutes]);
  const startHourOptions = useMemo(
    () => [...new Set(createStartOptions.map((t) => t.split(":")[0]))],
    [createStartOptions]
  );
  const startMinuteOptions = useMemo(() => {
    const selectedHour = hourPart(startTime);
    return createStartOptions
      .filter((t) => t.startsWith(`${selectedHour}:`))
      .map((t) => t.split(":")[1]);
  }, [createStartOptions, startTime]);
  const createEndOptions = useMemo(() => {
    const all = HOUR_OPTIONS.flatMap((h) => MINUTE_OPTIONS.map((m) => `${h}:${m}`));
    const startMinutes = timeToMinutes(startTime);
    if (!Number.isFinite(startMinutes)) return [];
    return all.filter((t) => {
      const candidate = timeToMinutes(t);
      if (!Number.isFinite(candidate) || candidate <= startMinutes) return false;
      if (workDate === today && candidate <= nowMinutes) return false;
      return true;
    });
  }, [startTime, workDate, today, nowMinutes]);
  const endHourOptions = useMemo(
    () => [...new Set(createEndOptions.map((t) => t.split(":")[0]))],
    [createEndOptions]
  );
  const endMinuteOptions = useMemo(() => {
    const selectedHour = hourPart(endTime);
    return createEndOptions
      .filter((t) => t.startsWith(`${selectedHour}:`))
      .map((t) => t.split(":")[1]);
  }, [createEndOptions, endTime]);

  const bulkUpdateStartOptions = useMemo(() => {
    const all = HOUR_OPTIONS.flatMap((h) => MINUTE_OPTIONS.map((m) => `${h}:${m}`));
    if (bulkUpdateWorkDate !== today) return all;
    return all.filter((t) => timeToMinutes(t) > nowMinutes);
  }, [bulkUpdateWorkDate, today, nowMinutes]);
  const bulkUpdateStartHourOptions = useMemo(
    () => [...new Set(bulkUpdateStartOptions.map((t) => t.split(":")[0]))],
    [bulkUpdateStartOptions]
  );
  const bulkUpdateStartHour = bulkUpdateStartTime ? hourPart(bulkUpdateStartTime) : "";
  const bulkUpdateStartMinute = bulkUpdateStartTime ? minutePart(bulkUpdateStartTime) : "";
  const bulkUpdateStartMinuteOptions = useMemo(() => {
    if (!bulkUpdateStartHour) return [];
    return bulkUpdateStartOptions
      .filter((t) => t.startsWith(`${bulkUpdateStartHour}:`))
      .map((t) => t.split(":")[1]);
  }, [bulkUpdateStartOptions, bulkUpdateStartHour]);
  const bulkUpdateEndOptions = useMemo(() => {
    const all = HOUR_OPTIONS.flatMap((h) => MINUTE_OPTIONS.map((m) => `${h}:${m}`));
    const startMinutes = timeToMinutes(bulkUpdateStartTime);
    if (!Number.isFinite(startMinutes)) return [];
    return all.filter((t) => {
      const candidate = timeToMinutes(t);
      if (!Number.isFinite(candidate) || candidate <= startMinutes) return false;
      if (bulkUpdateWorkDate === today && candidate <= nowMinutes) return false;
      return true;
    });
  }, [bulkUpdateStartTime, bulkUpdateWorkDate, today, nowMinutes]);
  const bulkUpdateEndHourOptions = useMemo(
    () => [...new Set(bulkUpdateEndOptions.map((t) => t.split(":")[0]))],
    [bulkUpdateEndOptions]
  );
  const bulkUpdateEndHour = bulkUpdateEndTime ? hourPart(bulkUpdateEndTime) : "";
  const bulkUpdateEndMinute = bulkUpdateEndTime ? minutePart(bulkUpdateEndTime) : "";
  const bulkUpdateEndMinuteOptions = useMemo(() => {
    if (!bulkUpdateEndHour) return [];
    return bulkUpdateEndOptions
      .filter((t) => t.startsWith(`${bulkUpdateEndHour}:`))
      .map((t) => t.split(":")[1]);
  }, [bulkUpdateEndOptions, bulkUpdateEndHour]);

  const editWorkDate = useMemo(() => toDateOnly(editingSlot?.work_date), [editingSlot?.work_date]);
  const editStartOptions = useMemo(() => {
    const all = HOUR_OPTIONS.flatMap((h) => MINUTE_OPTIONS.map((m) => `${h}:${m}`));
    if (editWorkDate !== today) return all;
    return all.filter((t) => timeToMinutes(t) > nowMinutes);
  }, [editWorkDate, today, nowMinutes]);
  const editStartHourOptions = useMemo(
    () => [...new Set(editStartOptions.map((t) => t.split(":")[0]))],
    [editStartOptions]
  );
  const editStartMinuteOptions = useMemo(() => {
    if (!editingSlot) return [];
    const selectedHour = hourPart(editingSlot.start_time);
    return editStartOptions
      .filter((t) => t.startsWith(`${selectedHour}:`))
      .map((t) => t.split(":")[1]);
  }, [editStartOptions, editingSlot]);
  const editEndOptions = useMemo(() => {
    const all = HOUR_OPTIONS.flatMap((h) => MINUTE_OPTIONS.map((m) => `${h}:${m}`));
    if (!editingSlot) return all;
    const startMinutes = timeToMinutes(editingSlot.start_time);
    if (!Number.isFinite(startMinutes)) return [];
    return all.filter((t) => {
      const candidate = timeToMinutes(t);
      if (!Number.isFinite(candidate) || candidate <= startMinutes) return false;
      if (editWorkDate === today && candidate <= nowMinutes) return false;
      return true;
    });
  }, [editingSlot, editWorkDate, today, nowMinutes]);
  const editEndHourOptions = useMemo(
    () => [...new Set(editEndOptions.map((t) => t.split(":")[0]))],
    [editEndOptions]
  );
  const editEndMinuteOptions = useMemo(() => {
    if (!editingSlot) return [];
    const selectedHour = hourPart(editingSlot.end_time);
    return editEndOptions
      .filter((t) => t.startsWith(`${selectedHour}:`))
      .map((t) => t.split(":")[1]);
  }, [editEndOptions, editingSlot]);

  function openEditSlot(slot: ScheduleSlot) {
    setEditingSlot(slot);
    setEditPriceInput(String(Math.floor(Number(slot.price || 0))));
    setEditMaxPatientsInput(String(Math.max(1, Number(slot.max_patients || 1))));
  }

  const loadServices = useCallback(async () => {
    const token = getAccessToken();
    const res = await apiClient.get<{ data: DoctorService[] }>("/api/doctor/services", token);
    const data = res.data || [];
    setServices(data);
    if (data.length > 0 && serviceId === 0) {
      setServiceId(data[0].id);
      setBulkServiceId(data[0].id);
    }
  }, [serviceId]);

  const loadSlots = useCallback(async () => {
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
      showToast(error instanceof Error ? error.message : "Không thể tải lịch khám", "error");
    } finally {
      setLoading(false);
    }
  }, [dateFilter, serviceFilter, showToast, statusFilter]);

  const loadBulkTargetSlots = useCallback(async () => {
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
  }, [bulkServiceId, bulkWorkDate]);

  async function createSchedule() {
    const slotDuration = Number(slotDurationInput);
    const normalizedPriceInput = priceInput.trim();
    const normalizedRoom = room.trim();
    const price = Number(normalizedPriceInput);
    const nowTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());

    if (!workDate || !startTime || !endTime || !Number.isInteger(slotDuration) || slotDuration <= 0 || serviceId <= 0) {
      showToast("Vui lòng nhập đủ thông tin tạo lịch khám", "error");
      return;
    }
    if (workDate === today && startTime <= nowTime) {
      showToast("Không thể tạo lịch cho giờ đã qua trong ngày hôm nay", "error");
      return;
    }
    if (!normalizedRoom) {
      showToast("Vui lòng nhập phòng khám", "error");
      return;
    }
    if (!normalizedPriceInput) {
      showToast("Vui lòng nhập giá khám", "error");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      showToast("Giá khám không hợp lệ", "error");
      return;
    }
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes - startMinutes < slotDuration) {
      showToast("Khoảng giờ phải dài hơn độ dài slot", "error");
      return;
    }

    const payload: CreateScheduleBody = {
      work_date: workDate,
      start_time: `${startTime}:00`,
      end_time: `${endTime}:00`,
      slot_duration: slotDuration,
      service_id: serviceId,
      price,
      room: normalizedRoom,
      max_patients: 1,
    };

    try {
      setSaving(true);
      const token = getAccessToken();
      await apiClient.post("/api/doctor/schedules", payload, token);
      showToast("Tạo lịch khám thành công", "success");
      await loadSlots();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể tạo lịch khám", "error");
    } finally {
      setSaving(false);
    }
  }

  async function updateSlot() {
    if (!editingSlot) return;
    const nextWorkDate = toDateOnly(editingSlot.work_date);
    const nextStartMinutes = timeToMinutes(editingSlot.start_time);
    const nextEndMinutes = timeToMinutes(editingSlot.end_time);
    const nextPrice = Number(editPriceInput || "0");
    const nextMaxPatients = Number(editMaxPatientsInput);

    if (!nextWorkDate) {
      showToast("Ngày không hợp lệ", "error");
      return;
    }
    if (isPastDate(nextWorkDate, today)) {
      showToast("Không thể sửa lịch của ngày đã qua", "error");
      return;
    }
    if (!Number.isFinite(nextStartMinutes) || !Number.isFinite(nextEndMinutes)) {
      showToast("Giờ không hợp lệ", "error");
      return;
    }
    if (nextWorkDate === today && nextStartMinutes <= nowMinutes) {
      showToast("Không thể chọn giờ đã qua trong ngày hôm nay", "error");
      return;
    }
    if (nextEndMinutes <= nextStartMinutes) {
      showToast("Khoảng giờ không hợp lệ", "error");
      return;
    }
    if (nextWorkDate === today && nextEndMinutes <= nowMinutes) {
      showToast("Không thể chọn giờ đã qua trong ngày hôm nay", "error");
      return;
    }
    if (!Number.isInteger(nextMaxPatients) || nextMaxPatients <= 0) {
      showToast("Số lượng bệnh nhân phải là số nguyên dương", "error");
      return;
    }
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      showToast("Giá khám không hợp lệ", "error");
      return;
    }

    const payload: UpdateScheduleBody = {
      service_id: editingSlot.service_id,
      work_date: nextWorkDate,
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
      showToast("Cập nhật slot thành công", "success");
      setEditingSlot(null);
      await loadSlots();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể cập nhật slot", "error");
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
      showToast(nextStatus === "closed" ? "Đã khóa lịch" : "Đã mở lịch", "success");
      await loadSlots();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể cập nhật trạng thái lịch";
      if (message.includes("Trùng giờ đã tồn tại")) {
        showToast("Bạn thao tác quá nhanh, vui lòng bấm lại sau 1 giây.", "error");
        await loadSlots();
      } else {
        showToast(message, "error");
      }
    } finally {
      setLockingSlotId(null);
    }
  }

  async function confirmLockSlotChange() {
    if (!confirmLockSlot) return;
    const slot = confirmLockSlot;
    setConfirmLockSlot(null);
    await toggleLockSlot(slot);
  }

  async function bulkUpdateByService() {
    const normalizedBulkPriceInput = bulkPriceInput.trim();
    const normalizedBulkRoom = bulkRoom.trim();
    const nextPrice = Number(normalizedBulkPriceInput);
    const hasCustomBulkTimeFilter = bulkUpdateStartTime.trim() !== "" || bulkUpdateEndTime.trim() !== "";
    const customBulkStartTime = hasCustomBulkTimeFilter ? bulkUpdateStartTime.trim() : "";
    const customBulkEndTime = hasCustomBulkTimeFilter ? bulkUpdateEndTime.trim() : "";
    const nextBulkSlotDuration = Number(bulkSlotDurationInput);

    if (bulkServiceId <= 0) {
      showToast("Vui lòng chọn dịch vụ cần cập nhật hàng loạt", "error");
      return;
    }
    if (!bulkWorkDate) {
      showToast("Vui lòng chọn ngày cần cập nhật", "error");
      return;
    }
    if (isPastDate(bulkWorkDate, today)) {
      showToast("Không thể chọn ngày đã qua", "error");
      return;
    }
    if (!normalizedBulkPriceInput) {
      showToast("Vui lòng nhập giá khám mới", "error");
      return;
    }
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      showToast("Giá khám không hợp lệ", "error");
      return;
    }
    if (!normalizedBulkRoom) {
      showToast("Vui lòng nhập phòng khám mới", "error");
      return;
    }
    if ((customBulkStartTime && !customBulkEndTime) || (!customBulkStartTime && customBulkEndTime)) {
      showToast("Cần chọn đầy đủ giờ bắt đầu và giờ kết thúc", "error");
      return;
    }
    const customBulkStartMinutes = customBulkStartTime ? timeToMinutes(customBulkStartTime) : Number.NaN;
    const customBulkEndMinutes = customBulkEndTime ? timeToMinutes(customBulkEndTime) : Number.NaN;
    if (
      customBulkStartTime &&
      customBulkEndTime &&
      (!Number.isFinite(customBulkStartMinutes) ||
        !Number.isFinite(customBulkEndMinutes) ||
        customBulkStartMinutes >= customBulkEndMinutes)
    ) {
      showToast("Khoảng giờ áp dụng không hợp lệ", "error");
      return;
    }
    if (!Number.isInteger(nextBulkSlotDuration) || nextBulkSlotDuration <= 0) {
      showToast("Độ dài slot không hợp lệ", "error");
      return;
    }
    if (
      customBulkStartTime &&
      customBulkEndTime &&
      Number.isFinite(customBulkStartMinutes) &&
      Number.isFinite(customBulkEndMinutes) &&
      customBulkEndMinutes - customBulkStartMinutes < nextBulkSlotDuration
    ) {
      showToast("Khoảng giờ phải dài hơn độ dài slot", "error");
      return;
    }

    try {
      const selectedRange = !hasCustomBulkTimeFilter && bulkRangeValue !== "all" ? bulkRangeValue.split("|") : null;
      const selectedStart = selectedRange?.[0] ?? null;
      const selectedEnd = selectedRange?.[1] ?? null;

      setBulkSaving(true);
      const token = getAccessToken();
      await apiClient.patch(
        "/api/doctor/schedules/bulk",
        {
          service_id: bulkServiceId,
          work_date: bulkWorkDate,
          start_time: customBulkStartTime || selectedStart || undefined,
          end_time: customBulkEndTime || selectedEnd || undefined,
          update_service_id: bulkUpdateServiceId > 0 ? bulkUpdateServiceId : undefined,
          update_work_date: bulkUpdateWorkDate || undefined,
          price: nextPrice,
          slot_duration: nextBulkSlotDuration,
          room: normalizedBulkRoom,
          status: bulkStatus === "auto" ? undefined : bulkStatus,
        },
        token
      );
      showToast("Cập nhật hàng loạt thành công", "success");
      await loadSlots();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể cập nhật hàng loạt", "error");
    } finally {
      setBulkSaving(false);
    }
  }

  function applyBulkRangeSelection(nextRangeValue: string) {
    setBulkRangeValue(nextRangeValue);

    if (!bulkServiceId || !bulkWorkDate) return;

    const daySlots = bulkTargetSlots
      .filter((slot) => slot.service_id === bulkServiceId && toDateOnly(slot.work_date) === bulkWorkDate)
      .slice()
      .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

    if (daySlots.length === 0) return;

    let selectedSlots = daySlots;
    if (nextRangeValue !== "all") {
      const [start, end] = nextRangeValue.split("|");
      if (!start || !end) return;
      selectedSlots = daySlots.filter(
        (slot) => toHHMM(slot.start_time) >= start && toHHMM(slot.end_time) <= end
      );
      if (selectedSlots.length === 0) return;
    }

    const first = selectedSlots[0];
    const last = selectedSlots[selectedSlots.length - 1];

    setBulkUpdateWorkDate(bulkWorkDate);
    setBulkUpdateStartTime(toHHMM(first.start_time));
    setBulkUpdateEndTime(toHHMM(last.end_time));
    setBulkPriceInput(String(Math.floor(Number(first.price || 0))));
    setBulkRoom(first.room || "");
    setBulkStatus(first.status ?? "auto");
    setBulkUpdateServiceId(Number(first.service_id || 0));
  }

  useEffect(() => {
    Promise.all([loadServices(), loadSlots()]).catch((error) => {
      showToast(error instanceof Error ? error.message : "Không thể tải dữ liệu lịch khám", "error");
    });
  }, [loadServices, loadSlots, showToast]);

  useEffect(() => {
    if (createStartOptions.length === 0) return;
    if (!createStartOptions.includes(startTime)) {
      setStartTime(createStartOptions[0]);
    }
  }, [createStartOptions, startTime]);

  useEffect(() => {
    if (createEndOptions.length === 0) return;
    if (!createEndOptions.includes(endTime)) {
      setEndTime(createEndOptions[0]);
    }
  }, [createEndOptions, endTime]);

  useEffect(() => {
    if (!editingSlot || editStartOptions.length === 0) return;
    const currentStart = toHHMM(editingSlot.start_time);
    if (!editStartOptions.includes(currentStart)) {
      setEditingSlot({
        ...editingSlot,
        start_time: `${editStartOptions[0]}:00`,
      });
    }
  }, [editStartOptions, editingSlot]);

  useEffect(() => {
    if (!editingSlot || editEndOptions.length === 0) return;
    const currentEnd = toHHMM(editingSlot.end_time);
    if (!editEndOptions.includes(currentEnd)) {
      setEditingSlot({
        ...editingSlot,
        end_time: `${editEndOptions[0]}:00`,
      });
    }
  }, [editEndOptions, editingSlot]);

  useEffect(() => {
    if (!bulkUpdateStartTime || bulkUpdateStartOptions.length === 0) return;
    if (!bulkUpdateStartOptions.includes(bulkUpdateStartTime)) {
      setBulkUpdateStartTime(bulkUpdateStartOptions[0]);
    }
  }, [bulkUpdateStartOptions, bulkUpdateStartTime]);

  useEffect(() => {
    if (!bulkUpdateStartTime || bulkUpdateEndOptions.length === 0) return;
    if (!bulkUpdateEndOptions.includes(bulkUpdateEndTime)) {
      setBulkUpdateEndTime(bulkUpdateEndOptions[0]);
    }
  }, [bulkUpdateEndOptions, bulkUpdateEndTime, bulkUpdateStartTime]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  useEffect(() => {
    setBulkRangeValue("all");
  }, [bulkServiceId, bulkWorkDate]);

  useEffect(() => {
    loadBulkTargetSlots();
  }, [loadBulkTargetSlots]);

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

  useEffect(() => {
    setBulkRangeValue("all");
    setBulkUpdateWorkDate("");
    setBulkUpdateStartTime("");
    setBulkUpdateEndTime("");
    setBulkPriceInput("");
    setBulkRoom("");
    setBulkStatus("auto");
    setBulkUpdateServiceId(0);
  }, [bulkServiceId, bulkWorkDate]);

  const groupedSlots = useMemo<SlotGroup[]>(() => {
    const ordered = [...slots].sort((a, b) => {
      const dateA = toDateOnly(a.work_date);
      const dateB = toDateOnly(b.work_date);
      const aIsToday = dateA === today;
      const bIsToday = dateB === today;

      if (aIsToday !== bIsToday) return aIsToday ? -1 : 1;

      const dateDiff = dateB.localeCompare(dateA);
      if (dateDiff !== 0) return dateDiff;
      if (a.service_id !== b.service_id) return a.service_id - b.service_id;
      return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
    });

    const groups: SlotGroup[] = [];

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
  }, [slots, today]);

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Tạo lịch khám</h2>

      <div className={styles.modeSwitchWrap}>
        <button
          type="button"
          className={`${styles.modeBtn} ${formMode === "create" ? styles.modeBtnActive : ""}`}
          onClick={() => setFormMode("create")}
        >
          Tạo lịch khám
        </button>
        <button
          type="button"
          className={`${styles.modeBtn} ${formMode === "bulk" ? styles.modeBtnActive : ""}`}
          onClick={() => setFormMode("bulk")}
        >
          Cập nhật hàng loạt
        </button>
        <button
          type="button"
          className={`${styles.modeBtn} ${formMode === "list" ? styles.modeBtnActive : ""}`}
          onClick={() => setFormMode("list")}
        >
          Danh sách
        </button>
      </div>

      {formMode === "list" ? (
        <section className={styles.formCard}>
          <section className={styles.filterCard}>
            <h3 className={styles.subTitle}>Bộ lọc danh sách lịch khám</h3>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Chọn dịch vụ</label>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={serviceFilter}
                  onChange={(e) => setServiceFilter(Number(e.target.value))}
                >
                  <option value={0}>Tất cả dịch vụ</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Lọc theo ngày</label>
                <input
                  type="date"
                  className={styles.input}
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Lọc theo trạng thái</label>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "all" | SlotStatus)}
                >
                  <option value="all">Tất cả</option>
                  <option value="available">Còn chỗ</option>
                  <option value="full">Đã đầy</option>
                  <option value="closed">Đóng</option>
                </select>
              </div>
              <div className={`${styles.field} ${styles.filterActionField}`}>
                <label className={styles.label}> </label>
                <button
                  className={`${styles.secondaryBtn} ${styles.filterResetBtn}`}
                  type="button"
                  onClick={() => {
                    setDateFilter("");
                    setStatusFilter("all");
                    setServiceFilter(0);
                  }}
                >
                  Xóa bộ lọc
                </button>
              </div>
            </div>
          </section>

          <h3 className={styles.subTitle}>Danh sách lịch khám</h3>
          <div className={styles.listContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Dịch vụ</th>
                  <th className={styles.th}>Ngày</th>
                  <th className={styles.th}>Giờ</th>
                  <th className={styles.th}>Phòng</th>
                  <th className={styles.th}>Giá khám</th>
                  <th className={styles.th}>Trạng thái</th>
                  <th className={`${styles.th} ${styles.actionHeader}`}>Thao tác</th>
                </tr>
              </thead>
              {groupedSlots.map((group) => {
                const isGrouped = group.slots.length > 1;
                return (
                  <tbody
                    key={group.key}
                    className={`${styles.groupBody} ${isGrouped ? styles.groupBodyDark : ""}`}
                  >
                    {group.slots.map((slot) => (
                      <tr key={slot.id}>
                        <td className={styles.td}>
                          <div>{slot.service_name || serviceNameById.get(slot.service_id) || "Dịch vụ đã bị xóa"}</div>
                        </td>
                        <td className={styles.td}>
                          <div>{toDateOnly(slot.work_date)}</div>
                        </td>
                        <td className={styles.td}>
                          <div>
                            {slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}
                          </div>
                        </td>
                        <td className={styles.td}>
                          <div>{slot.room || "-"}</div>
                        </td>
                        <td className={styles.td}>
                          <div>{Number(slot.price || 0).toLocaleString("vi-VN")} đ</div>
                        </td>
                        <td className={styles.td}>
                          <span className={`${styles.statusBadge} ${styles[`status_${slot.status}`]}`}>
                            {statusLabel(slot.status)}
                          </span>
                        </td>
                        <td className={`${styles.td} ${styles.actionCell}`}>
                          <div className={styles.actionGroup}>
                            <button
                              className={`${styles.lockBtn} ${slot.status === "closed" ? styles.lockBtnDanger : ""}`}
                              onClick={() => setConfirmLockSlot(slot)}
                              disabled={lockingSlotId === slot.id}
                            >
                              {lockingSlotId === slot.id
                                ? "Đang xử lý..."
                                : slot.status === "closed"
                                  ? "Mở lịch"
                                  : "Khóa lịch"}
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
                    <td className={styles.emptyCell} colSpan={7}>
                      Chưa có lịch khám nào.
                    </td>
                  </tr>
                </tbody>
              ) : null}
            </table>
          </div>
        </section>
      ) : formMode === "create" ? (
        <section className={styles.formCard}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Ngày làm việc</label>
              <input
                type="date"
                min={today}
                className={styles.input}
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Dịch vụ</label>
              <select
                className={`${styles.input} ${styles.selectInput}`}
                value={serviceId}
                onChange={(e) => setServiceId(Number(e.target.value))}
              >
                <option value={0}>Chọn dịch vụ</option>
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
              <label className={styles.label}>Giờ bắt đầu</label>
              <div className={styles.row}>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={hourPart(startTime)}
                  onChange={(e) => setStartTime(`${e.target.value}:${minutePart(startTime)}`)}
                >
                  {startHourOptions.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={minutePart(startTime)}
                  onChange={(e) => setStartTime(`${hourPart(startTime)}:${e.target.value}`)}
                >
                  {startMinuteOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Giờ kết thúc</label>
              <div className={styles.row}>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={hourPart(endTime)}
                  onChange={(e) => setEndTime(`${e.target.value}:${minutePart(endTime)}`)}
                >
                  {endHourOptions.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={minutePart(endTime)}
                  onChange={(e) => setEndTime(`${hourPart(endTime)}:${e.target.value}`)}
                >
                  {endMinuteOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Độ dài slot (phút)</label>
              <select
                className={`${styles.input} ${styles.selectInput}`}
                value={slotDurationInput}
                onChange={(e) => setSlotDurationInput(e.target.value)}
              >
                <option value="15">15 phút</option>
                <option value="30">30 phút</option>
                <option value="60">60 phút</option>
              </select>
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Phòng khám</label>
              <input className={styles.input} placeholder="Ví dụ: P201" value={room} onChange={(e) => setRoom(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Giá khám</label>
              <input
                type="text"
                inputMode="numeric"
                className={styles.input}
                value={priceInput}
                onChange={(e) => setPriceInput(keepDigits(e.target.value))}
                required
              />
            </div>
          </div>

          <div className={styles.buttonRow}>
            <button className={styles.primaryBtn} disabled={saving} onClick={createSchedule}>
              {saving ? "Đang tạo..." : "Tạo lịch khám"}
            </button>
          </div>
        </section>
      ) : (
        <section className={styles.formCard}>
          <h3 className={styles.subTitle}>Cập nhật hàng loạt theo dịch vụ</h3>
          <div className={styles.bulkGrid}>
            <div className={`${styles.bulkCard} ${styles.bulkScopeCard}`}>
              <h4 className={styles.bulkCardTitle}>Lọc phạm vi áp dụng</h4>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>Dịch vụ cần áp dụng</label>
                  <select
                    className={`${styles.input} ${styles.selectInput}`}
                    value={bulkServiceId}
                    onChange={(e) => setBulkServiceId(Number(e.target.value))}
                  >
                    <option value={0}>Chọn dịch vụ</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Ngày áp dụng</label>
                  <input
                    type="date"
                    min={today}
                    className={styles.input}
                    value={bulkWorkDate}
                    onChange={(e) => setBulkWorkDate(e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>Ca áp dụng</label>
                  <select
                    className={`${styles.input} ${styles.selectInput}`}
                    value={bulkRangeValue}
                    onChange={(e) => applyBulkRangeSelection(e.target.value)}
                    disabled={!bulkWorkDate || !bulkServiceId}
                  >
                    <option value="all">Tất cả khung giờ trong ngày</option>
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
              <h4 className={styles.bulkCardTitle}>Thông tin muốn thay đổi</h4>
              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>Dịch vụ mới (nếu đổi)</label>
                  <select
                    className={`${styles.input} ${styles.selectInput}`}
                    value={bulkUpdateServiceId}
                    onChange={(e) => setBulkUpdateServiceId(Number(e.target.value))}
                  >
                    <option value={0}>Giữ nguyên dịch vụ</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Ngày mới (nếu đổi)</label>
                  <input
                    type="date"
                    min={today}
                    className={styles.input}
                    value={bulkUpdateWorkDate}
                    onChange={(e) => setBulkUpdateWorkDate(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>Giờ bắt đầu áp dụng</label>
                  <div className={styles.row}>
                    <select
                      className={`${styles.input} ${styles.selectInput}`}
                      value={bulkUpdateStartHour}
                      onChange={(e) => {
                        const nextHour = e.target.value;
                        if (!nextHour) {
                          setBulkUpdateStartTime("");
                          return;
                        }
                        const nextMinute = bulkUpdateStartMinuteOptions[0] ?? "00";
                        setBulkUpdateStartTime(`${nextHour}:${nextMinute}`);
                      }}
                    >
                      <option value="">Chọn giờ</option>
                      {bulkUpdateStartHourOptions.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <select
                      className={`${styles.input} ${styles.selectInput}`}
                      value={bulkUpdateStartMinute}
                      onChange={(e) => {
                        const nextMinute = e.target.value;
                        if (!nextMinute || !bulkUpdateStartHour) {
                          setBulkUpdateStartTime("");
                          return;
                        }
                        setBulkUpdateStartTime(`${bulkUpdateStartHour}:${nextMinute}`);
                      }}
                    >
                      <option value="">Chọn phút</option>
                      {bulkUpdateStartMinuteOptions.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Giờ kết thúc áp dụng</label>
                  <div className={styles.row}>
                    <select
                      className={`${styles.input} ${styles.selectInput}`}
                      value={bulkUpdateEndHour}
                      onChange={(e) => {
                        const nextHour = e.target.value;
                        if (!nextHour) {
                          setBulkUpdateEndTime("");
                          return;
                        }
                        const nextMinute = bulkUpdateEndMinuteOptions[0] ?? "00";
                        setBulkUpdateEndTime(`${nextHour}:${nextMinute}`);
                      }}
                    >
                      <option value="">Chọn giờ</option>
                      {bulkUpdateEndHourOptions.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <select
                      className={`${styles.input} ${styles.selectInput}`}
                      value={bulkUpdateEndMinute}
                      onChange={(e) => {
                        const nextMinute = e.target.value;
                        if (!nextMinute || !bulkUpdateEndHour) {
                          setBulkUpdateEndTime("");
                          return;
                        }
                        setBulkUpdateEndTime(`${bulkUpdateEndHour}:${nextMinute}`);
                      }}
                    >
                      <option value="">Chọn phút</option>
                      {bulkUpdateEndMinuteOptions.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>Độ dài slot (phút)</label>
                  <select
                    className={`${styles.input} ${styles.selectInput}`}
                    value={bulkSlotDurationInput}
                    onChange={(e) => setBulkSlotDurationInput(e.target.value)}
                  >
                    <option value="15">15 phút</option>
                    <option value="30">30 phút</option>
                    <option value="60">60 phút</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Giá khám mới</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={styles.input}
                    value={bulkPriceInput}
                    onChange={(e) => setBulkPriceInput(keepDigits(e.target.value))}
                  />
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.field}>
                  <label className={styles.label}>Phòng khám mới</label>
                  <input
                    className={styles.input}
                    value={bulkRoom}
                    onChange={(e) => setBulkRoom(e.target.value)}
                    placeholder="Để trống nếu muốn bỏ phòng"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Trạng thái sau cập nhật</label>
                  <select
                    className={`${styles.input} ${styles.selectInput}`}
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value as "auto" | SlotStatus)}
                  >
                    <option value="auto">Tự động theo số đã đặt</option>
                    <option value="available">Còn chỗ</option>
                    <option value="closed">Đóng</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.buttonRow}>
            <button className={styles.primaryBtn} disabled={bulkSaving} onClick={bulkUpdateByService}>
              {bulkSaving ? "Đang cập nhật..." : "Cập nhật tất cả slot của dịch vụ"}
            </button>
          </div>
        </section>
      )}

      {editingSlot ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>Sửa slot lịch khám</h3>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Dịch vụ</label>
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
                  min={today}
                  className={styles.input}
                  value={toDateOnly(editingSlot.work_date)}
                  onChange={(e) => setEditingSlot({ ...editingSlot, work_date: e.target.value })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Giờ bắt đầu</label>
                <div className={styles.row}>
                  <select
                    className={`${styles.input} ${styles.selectInput}`}
                    value={hourPart(editingSlot.start_time)}
                    onChange={(e) =>
                      setEditingSlot({
                        ...editingSlot,
                        start_time: `${e.target.value}:${minutePart(editingSlot.start_time)}:00`,
                      })
                    }
                  >
                    {editStartHourOptions.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <select
                    className={`${styles.input} ${styles.selectInput}`}
                    value={minutePart(editingSlot.start_time)}
                    onChange={(e) =>
                      setEditingSlot({
                        ...editingSlot,
                        start_time: `${hourPart(editingSlot.start_time)}:${e.target.value}:00`,
                      })
                    }
                  >
                    {editStartMinuteOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Giờ kết thúc</label>
                <div className={styles.row}>
                  <select
                    className={`${styles.input} ${styles.selectInput}`}
                    value={hourPart(editingSlot.end_time)}
                    onChange={(e) =>
                      setEditingSlot({
                        ...editingSlot,
                        end_time: `${e.target.value}:${minutePart(editingSlot.end_time)}:00`,
                      })
                    }
                  >
                    {editEndHourOptions.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <select
                    className={`${styles.input} ${styles.selectInput}`}
                    value={minutePart(editingSlot.end_time)}
                    onChange={(e) =>
                      setEditingSlot({
                        ...editingSlot,
                        end_time: `${hourPart(editingSlot.end_time)}:${e.target.value}:00`,
                      })
                    }
                  >
                    {editEndMinuteOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Phòng</label>
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
                <label className={styles.label}>Số bệnh nhân tối đa</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={styles.input}
                  value={editMaxPatientsInput}
                  onChange={(e) => setEditMaxPatientsInput(keepDigits(e.target.value))}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Trạng thái</label>
                <select
                  className={`${styles.input} ${styles.selectInput}`}
                  value={editingSlot.status}
                  onChange={(e) => setEditingSlot({ ...editingSlot, status: e.target.value as SlotStatus })}
                >
                  <option value="available">Còn chỗ</option>
                  <option value="full">Đã đầy</option>
                  <option value="closed">Đóng</option>
                </select>
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setEditingSlot(null)}>
                Hủy
              </button>
              <button className={styles.primaryBtn} disabled={saving} onClick={updateSlot}>
                {saving ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmLockSlot ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <h3 className={styles.modalTitle}>
              {confirmLockSlot.status === "closed" ? "Xác nhận mở lịch" : "Xác nhận khóa lịch"}
            </h3>
            <p>
              Bạn có chắc muốn{" "}
              <strong>{confirmLockSlot.status === "closed" ? "mở lịch" : "khóa lịch"}</strong> cho slot
              ngày <strong>{toDateOnly(confirmLockSlot.work_date)}</strong> từ{" "}
              <strong>{toHHMM(confirmLockSlot.start_time)}</strong> đến{" "}
              <strong>{toHHMM(confirmLockSlot.end_time)}</strong> không?
            </p>
            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setConfirmLockSlot(null)}>
                Hủy
              </button>
              <button
                className={styles.dangerBtn}
                disabled={lockingSlotId === confirmLockSlot.id}
                onClick={confirmLockSlotChange}
              >
                {lockingSlotId === confirmLockSlot.id ? "Đang xử lý..." : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
