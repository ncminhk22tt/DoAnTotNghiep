"use client";

import { FormEvent, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./create-doctor.module.css";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDoctorName(value: string) {
  const normalizedValue = value.trim();
  return normalizedValue.length >= 1
    && normalizedValue.length <= 50
    && /^[\p{L}]+(?:\s+[\p{L}]+)*$/u.test(normalizedValue);
}

export default function AdminCreateDoctorPage() {
  const { showToast } = useToast();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function resetForm() {
    setPhone("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setFullName("");
    setEmail("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    const normalizedFullName = fullName.trim();
    const normalizedPhone = phone.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();

    if (!normalizedFullName || !normalizedPhone || !normalizedEmail || !normalizedPassword) {
      showToast("Vui lòng nhập đầy đủ họ tên, email, số điện thoại và mật khẩu", "error");
      return;
    }

    if (!isValidDoctorName(normalizedFullName)) {
      showToast("Họ tên chỉ được 1 đến 50 ký tự, gồm chữ cái và khoảng trắng giữa các từ", "error");
      return;
    }

    if (!/^[0-9]{10,15}$/.test(normalizedPhone)) {
      showToast("Số điện thoại phải chứa 10 đến 15 chữ số", "error");
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      showToast("Email không hợp lệ", "error");
      return;
    }

    if (!/^[A-Za-z0-9]{8,15}$/.test(normalizedPassword)) {
      showToast("Mật khẩu phải từ 8 đến 15 ký tự và chỉ gồm chữ, số", "error");
      return;
    }

    if (password !== confirmPassword) {
      showToast("Mật khẩu nhập lại không khớp", "error");
      return;
    }

    setIsSaving(true);
    try {
      const token = getAccessToken();
      await apiClient.post(
        "/api/admin/create-doctor",
        {
          phone: normalizedPhone,
          password: normalizedPassword,
          full_name: normalizedFullName,
          email: normalizedEmail,
        },
        token
      );
      resetForm();
      showToast("Tạo tài khoản bác sĩ thành công", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Tạo tài khoản thất bại", "error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Tạo tài khoản bác sĩ</h2>

      <form onSubmit={onSubmit} className={styles.formCard}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Số điện thoại đăng nhập</label>
            <input
              className={styles.input}
              placeholder="Ví dụ: 0901234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Email</label>
            <input
              className={styles.input}
              placeholder="doctor@clinic.vn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Mật khẩu</label>
            <div className={styles.passwordWrap}>
              <input
                type={showPassword ? "text" : "password"}
                className={styles.input}
                placeholder="8-15 ký tự, chỉ chữ và số"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? "Ẩn" : "Hiện"}
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Nhập lại mật khẩu</label>
            <div className={styles.passwordWrap}>
              <input
                type={showPassword ? "text" : "password"}
                className={styles.input}
                placeholder="Nhập lại mật khẩu"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? "Ẩn" : "Hiện"}
              </button>
            </div>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Họ tên bác sĩ</label>
            <input
              className={styles.input}
              placeholder="Nhập họ tên"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className={styles.field} />
        </div>

        <div className={styles.buttonRow}>
          <button className={styles.primaryBtn} type="submit" disabled={isSaving}>
            {isSaving ? "Đang tạo..." : "Tạo tài khoản"}
          </button>
          <button className={styles.secondaryBtn} type="button" onClick={resetForm}>
            Làm mới
          </button>
        </div>
      </form>
    </div>
  );
}
