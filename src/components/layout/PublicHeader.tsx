"use client";

import { MouseEvent, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearAllAuthSessions, getActiveRole, getAuthUser } from "@/lib/authClient";
import type { AuthUser } from "@/types/frontend-auth";
import { NotificationBell } from "./NotificationBell";
import styles from "./PublicHeader.module.css";

const navItems = [
  { href: "/", label: "Trang chủ" },
  { href: "/chuyen-khoa", label: "Chuyên khoa" },
  { href: "/dich-vu", label: "Dịch vụ" },
  { href: "/bac-si", label: "Bác sĩ" },
] as const;

function resolvePersonalHref() {
  // Public home page only accepts patient as active signed-in role.
  const activeRole = getActiveRole();
  if (activeRole === "patient" && getAuthUser("patient")) return "/patient/appointments";
  return "/login";
}

function resolveAuthUser(): AuthUser | null {
  const activeRole = getActiveRole();
  if (activeRole === "patient") return getAuthUser("patient");
  return null;
}

export function PublicHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [personalHref, setPersonalHref] = useState("/login");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  function goPersonal(e?: MouseEvent) {
    e?.preventDefault();
    router.push(personalHref === "/patient/appointments" ? "/patient/appointments" : "/login");
  }

  useEffect(() => {
    const updateAuthState = () => {
      const nextPersonalHref = resolvePersonalHref();
      setPersonalHref(nextPersonalHref);
      setIsLoggedIn(nextPersonalHref !== "/login");
      setAuthUser(resolveAuthUser());
    };

    updateAuthState();
    window.addEventListener("storage", updateAuthState);
    window.addEventListener("focus", updateAuthState);
    return () => {
      window.removeEventListener("storage", updateAuthState);
      window.removeEventListener("focus", updateAuthState);
    };
  }, []);

  useEffect(() => {
    const nextPersonalHref = resolvePersonalHref();
    setPersonalHref(nextPersonalHref);
    setIsLoggedIn(nextPersonalHref !== "/login");
    setAuthUser(resolveAuthUser());
  }, [pathname]);

  if (pathname !== "/") return null;

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandDot} aria-hidden="true" />
          <span>Medical Booking</span>
        </Link>

        <nav className={styles.nav} aria-label="Điều hướng chính">
          {navItems.map((item) => (
            (() => {
              const isActive =
                pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navLink} ${isActive ? styles.active : ""}`}
            >
              {item.label}
            </Link>
              );
            })()
          ))}
        </nav>

        <div className={styles.actions}>
          {isLoggedIn ? (
            <>
              <NotificationBell user={authUser} />
              <Link href={personalHref} className={styles.profileBtn} onClick={goPersonal}>Cá nhân</Link>
              <button
                type="button"
                className={styles.logoutBtn}
                onClick={() => {
                  clearAllAuthSessions();
                  setIsLoggedIn(false);
                  setPersonalHref("/login");
                  setAuthUser(null);
                  router.push("/login");
                }}
              >
                Đăng xuất
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className={styles.loginBtn}>Đăng nhập</Link>
              <Link href="/register" className={styles.registerBtn}>Đăng ký</Link>
            </>
          )}
        </div>

        <div className={styles.mobileControls}>
          {isLoggedIn ? (
            <div className={styles.mobileNotice}>
              <NotificationBell user={authUser} showLabel />
            </div>
          ) : (
            <Link href="/login" className={styles.mobileLoginBtn}>Đăng nhập</Link>
          )}
          <button
            type="button"
            className={styles.menuButton}
            aria-label="Mở menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {isMenuOpen ? (
        <div className={styles.mobileMenu}>
          {navItems.map((item) => (
            (() => {
              const isActive =
                pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.mobileItem} ${isActive ? styles.active : ""}`}
              onClick={() => setIsMenuOpen(false)}
            >
              {item.label}
            </Link>
              );
            })()
          ))}
          <Link
            href={personalHref}
            className={styles.mobileItem}
            onClick={(e) => {
              setIsMenuOpen(false);
              goPersonal(e);
            }}
          >
            Cá nhân
          </Link>
          {isLoggedIn ? (
            <button
              type="button"
              className={styles.mobileItemButton}
              onClick={() => {
                clearAllAuthSessions();
                setIsMenuOpen(false);
                setIsLoggedIn(false);
                setPersonalHref("/login");
                setAuthUser(null);
                router.push("/login");
              }}
            >
              Đăng xuất
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
