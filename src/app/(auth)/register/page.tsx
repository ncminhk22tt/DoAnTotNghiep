"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import styles from "./page.module.css";

function isValidPhone(phone: string) {
  return /^[0-9]{10,15}$/.test(phone);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password: string) {
  return /^[A-Za-z0-9]{8,15}$/.test(password);
}

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    const fullName = form.full_name.trim();
    const phone = form.phone.trim();
    const email = form.email.trim().toLowerCase();
    const password = form.password;
    const confirmPassword = form.confirmPassword;
    const wordCount = fullName.split(/\s+/).filter(Boolean).length;

    if (!fullName || !phone || !email || !password || !confirmPassword) {
      setError("Vui lòng nhập đầy đủ thông tin");
      return;
    }

    if (wordCount === 0 || wordCount > 50) {
      setError("Họ tên phải từ 1 đến 50 từ");
      return;
    }

    if (!isValidPhone(phone)) {
      setError("Số điện thoại phải chứa 10 đến 15 chữ số");
      return;
    }

    if (!isValidEmail(email)) {
      setError("Email không hợp lệ");
      return;
    }

    if (!isValidPassword(password)) {
      setError("Mật khẩu phải từ 8 đến 15 ký tự chữ và số");
      return;
    }

    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp");
      return;
    }

    setLoading(true);
    try {
      const res = await apiClient.post<{ success: boolean; message: string }>("/api/auth/register", {
        full_name: fullName,
        phone,
        email,
        password,
      });
      setMessage(res.message || "Đăng ký thành công");
      setTimeout(() => router.push("/login"), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng ký thất bại");
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
                  d="M12 5v14m-7-7h14"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className={styles["login-title"]}>Đăng ký tài khoản</h1>
            <p className={styles["login-subtitle"]}>Tạo tài khoản để đặt lịch khám bệnh</p>
          </div>

          <form onSubmit={onSubmit} className={styles["login-form"]}>
            {message ? <p className={styles["success-message"]}>{message}</p> : null}
            {error ? <p className={styles["error-message"]}>{error}</p> : null}

            <div className={styles["form-group"]}>
              <label className={styles["form-label"]} htmlFor="full_name">Họ và tên</label>
              <div className={styles["input-wrapper"]}>
                <svg className={styles["input-icon"]} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 12c2.761 0 5-2.239 5-5s-2.239-5-5-5-5 2.239-5 5 2.239 5 5 5zM4 21a8 8 0 1116 0"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <input
                  id="full_name"
                  autoComplete="name"
                  type="text"
                  placeholder="Họ và tên"
                  value={form.full_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
                  className={styles["form-input"]}
                />
              </div>
            </div>

            <div className={styles["form-group"]}>
              <label className={styles["form-label"]} htmlFor="phone">Số điện thoại</label>
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
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className={styles["form-input"]}
                />
              </div>
            </div>

            <div className={styles["form-group"]}>
              <label className={styles["form-label"]} htmlFor="email">Email</label>
              <div className={styles["input-wrapper"]}>
                <svg className={styles["input-icon"]} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 6h16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2zm0 1l8 6 8-6"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <input
                  id="email"
                  autoComplete="email"
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  className={styles["form-input"]}
                />
              </div>
            </div>

            <div className={styles["form-group"]}>
              <label className={styles["form-label"]} htmlFor="password">Mật khẩu</label>
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
                  autoComplete="new-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Mật khẩu"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  className={styles["form-input"]}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className={styles["password-toggle"]}>
                  {showPassword ? "Ẩn" : "Hiện"}
                </button>
              </div>
            </div>

            <div className={styles["form-group"]}>
              <label className={styles["form-label"]} htmlFor="confirmPassword">Xác nhận mật khẩu</label>
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
                  id="confirmPassword"
                  autoComplete="new-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Xác nhận mật khẩu"
                  value={form.confirmPassword}
                  onChange={(e) => setForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                  className={styles["form-input"]}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className={styles["password-toggle"]}
                >
                  {showConfirmPassword ? "Ẩn" : "Hiện"}
                </button>
              </div>
            </div>

            <button disabled={loading} className={styles["submit-button"]}>
              {loading ? <span className={styles["loading-spinner"]}>◌</span> : null}
              <span>{loading ? "Đang xử lý..." : "Đăng ký"}</span>
            </button>

            <div className={styles["form-footer"]}>
              <Link href="/login" className={styles["footer-link"]}>Qua đăng nhập</Link>
              <Link href="/" className={styles["footer-link"]}>Về trang chủ</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
