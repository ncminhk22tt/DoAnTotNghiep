"use client";

import { RoleGuard } from "@/components/auth/RoleGuard";
import { AppShell } from "@/components/layout/AppShell";

const navItems = [
  { href: "/doctor", label: "Tổng quan" },
  { href: "/doctor/schedules", label: "Lịch làm việc" },
  // { href: "/doctor/schedules/list", label: "Danh sách lịch" },
  { href: "/doctor/appointments", label: "Lịch hẹn" },
  { href: "/doctor/medical-records", label: "Hồ sơ bệnh án" },
  { href: "/doctor/profile", label: "Hồ sơ bác sĩ" },
];

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow="doctor">
      <AppShell title="Cổng bác sĩ" navItems={navItems}>
        {children}
      </AppShell>
    </RoleGuard>
  );
}



