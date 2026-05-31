"use client";

import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";
import { getAuthUser } from "@/lib/authClient";
import { NotificationBell } from "@/components/layout/NotificationBell";

type AppShellProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  homeHref?: string;
  homeLabel?: string;
  showUserSubtitle?: boolean;
  navItems?: Array<{
    href: string;
    label: string;
  }>;
};

export function AppShell({
  children,
  title = "Dashboard",
  subtitle,
  backHref,
  backLabel = "Quay lại",
  homeHref,
  homeLabel = "Trang chủ",
  showUserSubtitle = true,
  navItems = [],
}: AppShellProps) {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<ReturnType<typeof getAuthUser>>(null);

  useEffect(() => {
    setMounted(true);
    setUser(getAuthUser());
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg-color)] text-[var(--text-primary)]">
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-[var(--border-color)] bg-[var(--surface-color)]/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              {backHref || homeHref ? (
                <Link
                  href={backHref ?? homeHref ?? "/"}
                  className="inline-flex items-center rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--primary-color)] hover:text-[var(--primary-color)]"
                >
                  {backHref ? backLabel : homeLabel}
                </Link>
              ) : null}
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
                {showUserSubtitle ? (
                  <p className="truncate text-sm text-[var(--text-secondary)]">
                  {subtitle || (mounted && user ? `Chào mừng, ${user.full_name || user.username}` : "Quản lý hệ thống y tế")}
                  </p>
                ) : subtitle ? (
                  <p className="truncate text-sm text-[var(--text-secondary)]">{subtitle}</p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {navItems.length > 0 ? (
                <nav className="hidden items-center gap-2 lg:flex">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="rounded-full px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--primary-color)]"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              ) : null}
              <NotificationBell user={mounted ? user : null} />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
