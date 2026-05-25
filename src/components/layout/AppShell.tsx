"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearAuthSession, getAuthUser } from "@/lib/authClient";
import { NotificationBell } from "./NotificationBell";
import styles from "./AppShell.module.css";

type NavItem = {
  href: string;
  label: string;
};

type AppShellProps = {
  title: string;
  navItems: NavItem[];
  children: React.ReactNode;
  homeHref?: string;
  homeLabel?: string;
};

export function AppShell({ title, navItems, children, homeHref, homeLabel = "Về Home" }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = getAuthUser();

  function handleLogout() {
    clearAuthSession(user?.role);
    router.replace("/login");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>
            {user ? `${user.full_name} (${user.role})` : "Chưa đăng nhập"}
          </p>
        </div>
        <div className={styles.headerActions}>
          {homeHref ? (
            <Link href={homeHref} className={styles.homeBtn}>
              {homeLabel}
            </Link>
          ) : null}
          <NotificationBell user={user} />
          <button onClick={handleLogout} className={styles.logoutBtn}>
            Đăng xuất
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <nav className={styles.nav}>
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navItem} ${
                    active ? styles.navItemActive : ""
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
