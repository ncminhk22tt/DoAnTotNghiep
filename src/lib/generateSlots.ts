export function generateSlots(
  start: string,
  end: string,
  duration: number
) {
  const slots: { start_time: string; end_time: string }[] = [];

  let current = new Date(`1970-01-01T${start}`);
  const endTime = new Date(`1970-01-01T${end}`);

  while (current < endTime) {
    const next = new Date(current.getTime() + duration * 60000);

    if (next > endTime) break;

    slots.push({
      start_time: current.toTimeString().slice(0, 8),
      end_time: next.toTimeString().slice(0, 8),
    });

    current = next;
  }

  return slots;
}