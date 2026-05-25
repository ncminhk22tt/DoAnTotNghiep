export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";

export function canTransitionAppointmentStatus(
  currentStatus: AppointmentStatus,
  nextStatus: AppointmentStatus
): boolean {
  if (currentStatus === nextStatus) return true;
  if (currentStatus === "pending" && ["confirmed", "cancelled", "completed", "no_show"].includes(nextStatus)) return true;
  if (currentStatus === "confirmed" && ["completed", "cancelled", "no_show"].includes(nextStatus)) return true;
  return false;
}
