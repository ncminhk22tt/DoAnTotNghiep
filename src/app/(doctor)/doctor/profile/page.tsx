"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken, getAuthUser, getRefreshToken, setAuthSession } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";

type Profile = {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  description?: string | null;
  gender: "male" | "female" | null;
  birth_year: number | null;
  role: "patient" | "doctor" | "admin";
  status: "active" | "inactive" | "banned";
  created_at: string;
};

export default function DoctorProfilePage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    avatar: "",
    gender: "male" as "male" | "female",
    birth_year: "",
    description: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    old_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [activeForm, setActiveForm] = useState<"profile" | "password">("profile");

  async function loadProfile() {
    try {
      setLoading(true);
      const token = getAccessToken();
      const res = await apiClient.get<{ data: Profile }>("/api/profile", token);
      setProfile(res.data);
      setForm({
        full_name: res.data.full_name || "",
        email: res.data.email || "",
        phone: res.data.phone || "",
        avatar: res.data.avatar || "",
        gender: res.data.gender === "female" ? "female" : "male",
        birth_year: res.data.birth_year ? String(res.data.birth_year) : "",
        description: res.data.description || "",
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể tải hồ sơ", "error");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalizedFullName = form.full_name.trim();
    const wordCount = normalizedFullName.split(/\s+/).filter(Boolean).length;
    const normalizedPhone = form.phone.trim();
    const normalizedEmail = form.email.trim().toLowerCase();

    if (!normalizedFullName || !normalizedPhone || !normalizedEmail) {
      showToast("Vui lòng nhập đầy đủ họ tên, email và số điện thoại", "error");
      return;
    }
    if (wordCount === 0 || wordCount > 50) {
      showToast("Họ tên phải từ 1 đến 50 từ", "error");
      return;
    }
    if (!normalizedPhone) {
      showToast("Số điện thoại không được để trống", "error");
      return;
    }
    if (!/^[0-9]{10,15}$/.test(normalizedPhone)) {
      showToast("Số điện thoại phải chứa 10 đến 15 chữ số", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      showToast("Email không hợp lệ", "error");
      return;
    }

    try {
      setSaving(true);
      const token = getAccessToken();
      await apiClient.patch(
        "/api/profile",
        {
          full_name: normalizedFullName,
          email: normalizedEmail,
          phone: normalizedPhone,
          avatar: form.avatar,
          gender: form.gender,
          birth_year: form.birth_year ? Number(form.birth_year) : null,
          description: form.description,
        },
        token
      );

      const currentUser = getAuthUser();
      const accessToken = getAccessToken();
      const refreshToken = getRefreshToken();
      if (currentUser && accessToken && refreshToken) {
        setAuthSession(accessToken, refreshToken, {
          ...currentUser,
          full_name: form.full_name || currentUser.full_name,
        });
      }

      showToast("Cập nhật hồ sơ bác sĩ thành công", "success");
      await loadProfile();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Cập nhật hồ sơ thất bại", "error");
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      showToast("Mật khẩu mới và xác nhận mật khẩu không khớp", "error");
      return;
    }
    try {
      setChangingPassword(true);
      const token = getAccessToken();
      await apiClient.post(
        "/api/auth/change-password",
        {
          old_password: passwordForm.old_password,
          new_password: passwordForm.new_password,
        },
        token
      );
      setPasswordForm({ old_password: "", new_password: "", confirm_password: "" });
      showToast("Đổi mật khẩu thành công", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Đổi mật khẩu thất bại", "error");
    } finally {
      setChangingPassword(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  if (loading) return <p>Đang tải hồ sơ...</p>;
  if (!profile) return <p>Không có dữ liệu hồ sơ.</p>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setActiveForm("profile")}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: activeForm === "profile" ? "#0b5fff" : "#fff",
            color: activeForm === "profile" ? "#fff" : "#334155",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Cập nhật thông tin
        </button>
        <button
          type="button"
          onClick={() => setActiveForm("password")}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: activeForm === "password" ? "#0b5fff" : "#fff",
            color: activeForm === "password" ? "#fff" : "#334155",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Đổi mật khẩu
        </button>
      </div>

      {activeForm === "profile" ? (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
            <input
              value={form.full_name ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
              placeholder="Họ và tên"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
            <input
              value={form.email ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="Email"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
            <input
              value={form.phone ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="Số điện thoại"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
            <select
              value={form.gender ?? "male"}
              onChange={(e) => setForm((prev) => ({ ...prev, gender: e.target.value as "male" | "female" }))}
              style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
            >
              <option value="male">Nam</option>
              <option value="female">Nữ</option>
            </select>
            <input
              type="number"
              min={1900}
              max={new Date().getFullYear()}
              value={form.birth_year ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, birth_year: e.target.value }))}
              placeholder="Năm sinh"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
            <textarea
              value={form.description ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Mô tả"
              rows={5}
              style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1", resize: "vertical" }}
            />
            <button
              type="submit"
              disabled={saving}
              style={{ padding: 10, border: "none", borderRadius: 8, background: "#0b5fff", color: "#fff" }}
            >
              {saving ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </form>
        </div>
      ) : null}

      {activeForm === "password" ? (
        <div style={{ padding: 16, background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0", height: "fit-content" }}>
          <h3 style={{ marginTop: 0 }}>Đổi mật khẩu</h3>
          <form onSubmit={onChangePassword} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 14, color: "#334155" }}>Mật khẩu cũ</label>
              <input
                type={showPassword ? "text" : "password"}
                value={passwordForm.old_password ?? ""}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, old_password: e.target.value }))}
                placeholder="Nhập mật khẩu cũ"
                style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 14, color: "#334155" }}>Mật khẩu mới</label>
              <input
                type={showPassword ? "text" : "password"}
                value={passwordForm.new_password ?? ""}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, new_password: e.target.value }))}
                placeholder="Nhập mật khẩu mới"
                style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 14, color: "#334155" }}>Xác nhận mật khẩu</label>
              <input
                type={showPassword ? "text" : "password"}
                value={passwordForm.confirm_password ?? ""}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm_password: e.target.value }))}
                placeholder="Nhập lại mật khẩu mới"
                style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
              />
            </div>
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              style={{ padding: 8, border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", color: "#334155", cursor: "pointer" }}
            >
              {showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            </button>
            <button
              type="submit"
              disabled={changingPassword}
              style={{ padding: 10, border: "none", borderRadius: 8, background: "#0b5fff", color: "#fff" }}
            >
              {changingPassword ? "Đang đổi..." : "Đổi mật khẩu"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
