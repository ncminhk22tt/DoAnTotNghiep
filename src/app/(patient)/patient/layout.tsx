"use client";

import { RoleGuard } from "@/components/auth/RoleGuard";
import { AppShell } from "@/components/layout/AppShell";

const navItems = [
  { href: "/patient/appointments", label: "Lịch hẹn" },
  { href: "/patient/notifications", label: "Thông báo" },
  { href: "/patient/medical-records", label: "Kết quả khám" },
  { href: "/patient/profile", label: "Hồ sơ cá nhân" },
];

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow="patient">
      <AppShell title="Quản lý cá nhân" navItems={navItems} homeHref="/" homeLabel="Về trang chủ">
        {children}
      </AppShell>
    </RoleGuard>
  );
}
