export function generateSlots(
  start: string,
  end: string,
  duration: number
) {
  const slots: { start_time: string; end_time: string }[] = [];
  if (!Number.isInteger(duration) || duration <= 0) return slots;

  const toMinutes = (value: string): number => {
    const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return Number.NaN;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      return Number.NaN;
    }
    return h * 60 + m;
  };

  const toHHMMSS = (totalMinutes: number): string => {
    const h = Math.floor(totalMinutes / 60)
      .toString()
      .padStart(2, "0");
    const m = (totalMinutes % 60).toString().padStart(2, "0");
    return `${h}:${m}:00`;
  };

  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes >= endMinutes) {
    return slots;
  }

  let current = startMinutes;
  while (current < endMinutes) {
    const next = current + duration;
    if (next > endMinutes) break;
    slots.push({
      start_time: toHHMMSS(current),
      end_time: toHHMMSS(next),
    });
    current = next;
  }

  return slots;
}
