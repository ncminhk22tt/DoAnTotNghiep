const CLINIC_TIME_ZONE = process.env.CLINIC_TIME_ZONE || "Asia/Ho_Chi_Minh";
const CLINIC_TZ_OFFSET = process.env.CLINIC_TZ_OFFSET || "+07:00";

type ClinicNow = {
  date: string;
  time: string;
};

function normalizeTimeToHms(time: string): string | null {
  const raw = time.trim();
  // Accept H:MM, HH:MM, HH:MM:SS formats and normalize to HH:MM:SS
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const parts = raw.split(":");
    const hh = parts[0].padStart(2, "0");
    return `${hh}:${parts[1]}:00`;
  }
  if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  return null;
}

function parseClinicDateTime(workDate: string, time: string): Date | null {
  const normalizedTime = normalizeTimeToHms(time);
  if (!normalizedTime) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return null;

  const value = new Date(`${workDate}T${normalizedTime}${CLINIC_TZ_OFFSET}`);
  if (Number.isNaN(value.getTime())) return null;
  return value;
}

function getClinicNow(): ClinicNow {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  const year = byType.get("year") || "0000";
  const month = byType.get("month") || "00";
  const day = byType.get("day") || "00";
  const hour = byType.get("hour") || "00";
  const minute = byType.get("minute") || "00";
  const second = byType.get("second") || "00";

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}:${second}`,
  };
}

export function isClinicSlotInPast(workDate: string | Date, startTime: string): boolean {
  const normalizedTime = normalizeTimeToHms(startTime);
  if (!normalizedTime) return true;

  // Extract date part from workDate (handle both "YYYY-MM-DD" and "YYYY-MM-DDTHH:MM:SS.000Z" formats)
  let dateStr: string;
  if (typeof workDate === "string") {
    dateStr = workDate.split("T")[0]; // Extract YYYY-MM-DD from ISO string
  } else {
    // Convert Date to local date string in clinic timezone
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: CLINIC_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(workDate);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const year = byType.get("year") || "0000";
    const month = byType.get("month") || "00";
    const day = byType.get("day") || "00";
    dateStr = `${year}-${month}-${day}`;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return true;

  const slotDate = parseClinicDateTime(dateStr, normalizedTime);
  if (!slotDate) return true;

  const now = getClinicNow();
  const clinicNow = new Date(`${now.date}T${now.time}${CLINIC_TZ_OFFSET}`);
  if (Number.isNaN(clinicNow.getTime())) return true;

  return slotDate.getTime() < clinicNow.getTime();
}

export function getMinutesUntilClinicSlot(workDate: string | Date, startTime: string): number | null {
  let dateStr: string;
  if (typeof workDate === "string") {
    dateStr = workDate.split("T")[0];
  } else {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: CLINIC_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(workDate);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const year = byType.get("year") || "0000";
    const month = byType.get("month") || "00";
    const day = byType.get("day") || "00";
    dateStr = `${year}-${month}-${day}`;
  }

  const slotDate = parseClinicDateTime(dateStr, startTime);
  if (!slotDate) return null;

  const now = new Date();
  // Use absolute epoch difference (slotDate already accounts for clinic TZ offset)
  return Math.floor((slotDate.getTime() - now.getTime()) / 60000);
}
