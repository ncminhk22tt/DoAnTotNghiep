"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clearAuthSession,
  getActiveRole,
  getAuthUser,
} from "@/lib/authClient";
import type { AuthUser, UserRole } from "@/types/frontend-auth";

type HeaderSession = {
  role: UserRole;
  user: AuthUser;
};

const ROLE_HOME: Record<UserRole, string> = {
  admin: "/admin",
  doctor: "/doctor",
  patient: "/patient",
};

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Trang admin",
  doctor: "Cổng bác sĩ",
  patient: "Tài khoản",
};

function resolveHeaderSession(): HeaderSession | null {
  const activeRole = getActiveRole();
  const roles: UserRole[] = activeRole
    ? [activeRole, ...(["patient", "doctor", "admin"] as UserRole[]).filter((role) => role !== activeRole)]
    : ["patient", "doctor", "admin"];

  for (const role of roles) {
    const user = getAuthUser(role);
    if (user) {
      return { role, user };
    }
  }

  return null;
}

export function PublicHeader() {
  const [session, setSession] = useState<HeaderSession | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSession(resolveHeaderSession());
  }, []);

  function handleLogout() {
    if (session) {
      clearAuthSession(session.role);
      setSession(null);
    }
  }

  const isLoggedIn = mounted && !!session;
  const dashboardHref = session ? ROLE_HOME[session.role] : "/login";
  const dashboardLabel = session ? ROLE_LABEL[session.role] : "Đăng nhập";
  const displayName = session?.user.full_name || session?.user.username;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border-color)] bg-[var(--surface-color)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="whitespace-nowrap text-lg font-semibold text-[var(--primary-color)]">
          Medical Booking
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          <Link href="/dich-vu" className="text-[var(--text-secondary)] transition-colors hover:text-[var(--primary-color)]">
            Dịch vụ
          </Link>
          <Link href="/bac-si" className="text-[var(--text-secondary)] transition-colors hover:text-[var(--primary-color)]">
            Bác sĩ
          </Link>
          <Link
            href={dashboardHref}
            className="rounded-full border border-[var(--border-color)] px-4 py-2 font-medium transition-colors hover:border-[var(--primary-color)] hover:text-[var(--primary-color)]"
            title={displayName}
          >
            {dashboardLabel}
          </Link>
          {isLoggedIn ? (
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-red-200 px-4 py-2 font-medium text-red-600 transition-colors hover:border-red-400 hover:bg-red-50"
            >
              Đăng xuất
            </button>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
