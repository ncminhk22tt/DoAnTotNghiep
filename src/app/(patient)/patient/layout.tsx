"use client";

import { RoleGuard } from "@/components/auth/RoleGuard";
import { AppShell } from "@/components/layout/AppShell";

const navItems = [
  { href: "/patient/appointments", label: "Lich hen" },
  { href: "/patient/notifications", label: "Thong bao" },
  { href: "/patient/medical-records", label: "Ket qua kham" },
  { href: "/patient/profile", label: "Ho so ca nhan" },
];

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow="patient">
      <AppShell title="Cong benh nhan" navItems={navItems} homeHref="/" homeLabel="Về trang chủ">
        {children}
      </AppShell>
    </RoleGuard>
  );
}
