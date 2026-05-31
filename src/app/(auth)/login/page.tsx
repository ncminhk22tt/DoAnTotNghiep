"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/apiClient";
import { clearAuthSession, setAuthSession } from "@/lib/authClient";
import { LoginResponse } from "@/types/frontend-auth";
import styles from "./page.module.css";

function isValidPhone(phone: string) {
  return /^[0-9]{10,15}$/.test(phone);
}

export default function LoginPage() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!phone.trim() || !password) {
      setError("Vui lòng nhập số điện thoại và mật khẩu");
      setLoading(false);
      return;
    }

    if (!isValidPhone(phone.trim())) {
      setError("Số điện thoại phải chứa 10 đến 15 chữ số");
      setLoading(false);
      return;
    }

    try {
      const res = await apiClient.post<LoginResponse>("/api/auth/login", {
        phone: phone.trim(),
        password,
      });

      setAuthSession(res.token, res.refresh_token, res.user);
      if (res.user.role !== "patient") {
        // Public home page only uses patient session.
        clearAuthSession("patient");
      }

      const query = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const nextPathRaw = query?.get("next") || "";
      const nextPath =
        nextPathRaw.startsWith("/") &&
        !nextPathRaw.startsWith("/api/") &&
        !nextPathRaw.startsWith("//") &&
        nextPathRaw !== "/login" &&
        nextPathRaw !== "/register"
          ? nextPathRaw
          : "";

      if (res.user.role === "admin") {
        window.location.replace("/admin");
      } else if (res.user.role === "doctor") {
        window.location.replace("/doctor");
      } else {
        window.location.replace(nextPath || "/");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles["login-container"]}>
      <div className={styles["login-wrapper"]}>
        <div className={styles["login-card"]}>
          <div className={styles["login-header"]}>
            <div className={styles["login-icon"]}>
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5zM4 21a8 8 0 1116 0"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className={styles["login-title"]}>Đăng nhập</h1>
            <p className={styles["login-subtitle"]}>Truy cập hệ thống đặt lịch khám bệnh</p>
          </div>

          <form onSubmit={onSubmit} className={styles["login-form"]}>
            {error ? (
              <p className={styles["error-message"]}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 8v5m0 3h.01M10.29 3.86l-8.18 14.5A2 2 0 003.82 21h16.36a2 2 0 001.71-2.64l-8.18-14.5a2 2 0 00-3.42 0z"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {error}
              </p>
            ) : null}

            <div className={styles["form-group"]}>
              <label className={styles["form-label"]} htmlFor="phone">
                Số điện thoại
              </label>
              <div className={styles["input-wrapper"]}>
                <svg className={styles["input-icon"]} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.8 19.8 0 012.08 4.18 2 2 0 014.06 2h3a2 2 0 012 1.72c.12.89.33 1.77.62 2.61a2 2 0 01-.45 2.11L8.1 9.6a16 16 0 006.3 6.3l1.16-1.15a2 2 0 012.11-.45c.84.29 1.72.5 2.61.62A2 2 0 0122 16.92z"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <input
                  id="phone"
                  autoComplete="tel"
                  type="tel"
                  placeholder="Số điện thoại"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className={styles["form-input"]}
                />
              </div>
            </div>

            <div className={styles["form-group"]}>
              <label className={styles["form-label"]} htmlFor="password">
                Mật khẩu
              </label>
              <div className={`${styles["input-wrapper"]} ${styles["password-wrapper"]}`}>
                <svg className={styles["input-icon"]} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M7 11V8a5 5 0 0110 0v3m-9 0h8a2 2 0 012 2v6a2 2 0 01-2 2H8a2 2 0 01-2-2v-6a2 2 0 012-2z"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <input
                  id="password"
                  autoComplete="current-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Mật khẩu"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={styles["form-input"]}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className={styles["password-toggle"]}>
                  {showPassword ? "Ẩn" : "Hiện"}
                </button>
              </div>
            </div>

            <button disabled={loading} className={styles["submit-button"]}>
              {loading ? <span className={styles["loading-spinner"]}>◌</span> : null}
              <span>{loading ? "Đang xử lý..." : "Đăng nhập"}</span>
            </button>

            <div className={styles["form-footer"]}>
              <Link href="/register" className={styles["footer-link"]}>
                Qua đăng ký
              </Link>
              <Link href="/" className={styles["footer-link"]}>
                Về trang chủ
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
