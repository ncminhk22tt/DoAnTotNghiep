"use client";

import { RoleGuard } from "@/components/auth/RoleGuard";
import { AppShell } from "@/components/layout/AppShell";

const navItems = [
  { href: "/admin", label: "Tổng quan" },
  { href: "/admin/appointments", label: "Lịch hẹn" },
  { href: "/admin/payments", label: "Thanh toán" },
  { href: "/admin/specialties", label: "Chuyên khoa" },
  { href: "/admin/services", label: "Dịch vụ" },
  { href: "/admin/doctors-setup", label: "Thiết lập bác sĩ" },
  { href: "/admin/users", label: "Quản lý người dùng" },
  { href: "/admin/create-doctor", label: "Tạo tài khoản bác sĩ" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow="admin">
      <AppShell title="Trang quản lý Admin" navItems={navItems}>
        {children}
      </AppShell>
    </RoleGuard>
  );
}
