"use client";

import { RoleGuard } from "@/components/auth/RoleGuard";
import { AppShell } from "@/components/layout/AppShell";

const navItems = [
  { href: "/admin", label: "Tong quan" },
  { href: "/admin/appointments", label: "Lich hen" },
  { href: "/admin/payments", label: "Thanh toan" },
  { href: "/admin/specialties", label: "Chuyen khoa" },
  { href: "/admin/services", label: "Dich vu" },
  { href: "/admin/doctors-setup", label: "Thiet lap bac si" },
  { href: "/admin/users", label: "Quan ly nguoi dung" },
  { href: "/admin/create-doctor", label: "Tao tai khoan bac si" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow="admin">
      <AppShell title="Cong quan tri" navItems={navItems}>
        {children}
      </AppShell>
    </RoleGuard>
  );
}
