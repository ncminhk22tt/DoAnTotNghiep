"use client";

import { FormEvent, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./create-doctor.module.css";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

    if (!phone.trim() || !password.trim() || !fullName.trim() || !email.trim()) {
      showToast("Vui long nhap day du thong tin bat buoc", "error");
      return;
    }

    if (!isValidEmail(email.trim())) {
      showToast("Email khong hop le", "error");
      return;
    }

    if (!/^[0-9]{10,15}$/.test(phone.trim())) {
      showToast("Phone phai tu 10 den 15 chu so", "error");
      return;
    }

    if (password.trim().length < 6) {
      showToast("Mat khau can it nhat 6 ky tu", "error");
      return;
    }

    if (password !== confirmPassword) {
      showToast("Mat khau nhap lai khong khop", "error");
      return;
    }

    setIsSaving(true);
    try {
      const token = getAccessToken();
      await apiClient.post(
        "/api/admin/create-doctor",
        {
          phone: phone.trim(),
          password: password.trim(),
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
        },
        token
      );
      resetForm();
      showToast("Tao tai khoan bac si thanh cong", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Tao tai khoan that bai", "error");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Tao tai khoan bac si</h2>

      <form onSubmit={onSubmit} className={styles.formCard}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Số điện thoại đăng nhập</label>
            <input
              className={styles.input}
              placeholder="Vi du: 0901234567"
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
            <label className={styles.label}>Mat khau</label>
            <div className={styles.passwordWrap}>
              <input
                type={showPassword ? "text" : "password"}
                className={styles.input}
                placeholder="It nhat 6 ky tu"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "An" : "Hien"}
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Nhap lai mat khau</label>
            <div className={styles.passwordWrap}>
              <input
                type={showPassword ? "text" : "password"}
                className={styles.input}
                placeholder="Nhap lai mat khau"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "An" : "Hien"}
              </button>
            </div>
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Ho ten bac si</label>
            <input
              className={styles.input}
              placeholder="Nhap ho ten"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className={styles.field} />
        </div>

        <div className={styles.buttonRow}>
          <button className={styles.primaryBtn} type="submit" disabled={isSaving}>
            {isSaving ? "Dang tao..." : "Tao tai khoan"}
          </button>
          <button className={styles.secondaryBtn} type="button" onClick={resetForm}>
            Lam moi
          </button>
        </div>
      </form>
    </div>
  );
}
