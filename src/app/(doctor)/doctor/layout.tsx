"use client";

import { RoleGuard } from "@/components/auth/RoleGuard";
import { AppShell } from "@/components/layout/AppShell";

const navItems = [
  { href: "/doctor", label: "Tong quan" },
  { href: "/doctor/schedules", label: "Lich lam viec" },
  { href: "/doctor/schedules/list", label: "Danh sach lich" },
  { href: "/doctor/appointments", label: "Lich hen" },
  { href: "/doctor/medical-records", label: "Ho so benh an" },
  { href: "/doctor/profile", label: "Ho so ca nhan" },
];

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow="doctor">
      <AppShell title="Cong bac si" navItems={navItems}>
        {children}
      </AppShell>
    </RoleGuard>
  );
}



