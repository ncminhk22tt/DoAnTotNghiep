"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAuthUser } from "@/lib/authClient";

export function PublicHeader() {
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<ReturnType<typeof getAuthUser>>(null);

  useEffect(() => {
    setMounted(true);
    setUser(getAuthUser("patient"));
  }, []);

  const isLoggedIn = mounted && !!user;
  const personalHref = isLoggedIn ? "/patient" : "/login";
  const displayName = user?.full_name || user?.username || "Tài khoản";

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border-color)] bg-[var(--surface-color)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold text-[var(--primary-color)]">
          Medical Booking
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          <Link href="/dich-vu" className="text-[var(--text-secondary)] transition-colors hover:text-[var(--primary-color)]">
            Dịch vụ
          </Link>
          <Link href="/bac-si" className="text-[var(--text-secondary)] transition-colors hover:text-[var(--primary-color)]">
            Bác sĩ
          </Link>
          <Link href={personalHref} className="rounded-full border border-[var(--border-color)] px-4 py-2 font-medium transition-colors hover:border-[var(--primary-color)] hover:text-[var(--primary-color)]">
            {isLoggedIn ? displayName : "Đăng nhập"}
          </Link>
        </nav>
      </div>
    </header>
  );
}
