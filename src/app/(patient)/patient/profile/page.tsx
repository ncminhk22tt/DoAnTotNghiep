"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken, getAuthUser, setAuthSession, getRefreshToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";

type Profile = {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  gender: "male" | "female" | null;
  birth_year: number | null;
  role: "patient" | "doctor" | "admin";
  status: "active" | "inactive" | "banned";
  created_at: string;
};

export default function PatientProfilePage() {
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
  });
  const [passwordForm, setPasswordForm] = useState({
    old_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

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
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the tai profile", "error");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      setSaving(true);
      const token = getAccessToken();
      await apiClient.patch(
        "/api/profile",
        {
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          avatar: form.avatar,
          gender: form.gender,
          birth_year: form.birth_year ? Number(form.birth_year) : null,
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

      showToast("Cap nhat profile thanh cong", "success");
      await loadProfile();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Cap nhat profile that bai", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarFileChange(file: File | null) {
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      showToast("Avatar chi ho tro png/jpg/webp", "error");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast("Avatar toi da 2MB", "error");
      return;
    }

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const content = result.includes(",") ? result.split(",")[1] : result;
        resolve(content);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    try {
      const token = getAccessToken();
      const res = await apiClient.post<{ data?: { avatar?: string } }>(
        "/api/profile/avatar",
        { file_name: file.name, content_base64: base64 },
        token
      );
      if (res?.data?.avatar) {
        setForm((prev) => ({ ...prev, avatar: res.data?.avatar || prev.avatar }));
      }
      showToast("Upload avatar thanh cong", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the upload avatar", "error");
    }
  }

  async function onChangePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      showToast("Mat khau moi va xac nhan mat khau khong khop", "error");
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
      showToast("Doi mat khau thanh cong", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Doi mat khau that bai", "error");
    } finally {
      setChangingPassword(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  if (loading) return <p>Dang tai profile...</p>;
  if (!profile) return <p>Khong co du lieu profile.</p>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Ho so ca nhan</h2>
        <p style={{ marginTop: 0, color: "#475569" }}>
          Username: <strong>{profile.username}</strong> | Role: <strong>{profile.role}</strong>
        </p>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          value={form.full_name}
          onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
          placeholder="Ho va ten"
          style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
        />
        <input
          value={form.email}
          onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
          placeholder="Email"
          style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
        />
        <input
          value={form.phone}
          onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
          placeholder="So dien thoai"
          style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
        />
        <select
          value={form.gender}
          onChange={(e) => setForm((prev) => ({ ...prev, gender: e.target.value as "male" | "female" }))}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
        >
          <option value="male">Nam</option>
          <option value="female">Nu</option>
        </select>
        <input
          type="number"
          min={1900}
          max={new Date().getFullYear()}
          value={form.birth_year}
          onChange={(e) => setForm((prev) => ({ ...prev, birth_year: e.target.value }))}
          placeholder="Nam sinh"
          style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
        />
        <input
          value={form.avatar}
          onChange={(e) => setForm((prev) => ({ ...prev, avatar: e.target.value }))}
          placeholder="Avatar URL/ten file"
          style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
        />
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => handleAvatarFileChange(e.target.files?.[0] || null)}
          style={{ padding: 6, borderRadius: 8, border: "1px solid #cbd5e1" }}
        />
        <button
          type="submit"
          disabled={saving}
          style={{ padding: 10, border: "none", borderRadius: 8, background: "#0b5fff", color: "#fff" }}
        >
          {saving ? "Dang luu..." : "Luu thay doi"}
        </button>
        </form>
      </div>

      <div style={{ padding: 16, background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0", height: "fit-content" }}>
        <h3 style={{ marginTop: 0 }}>Doi mat khau</h3>
        <form onSubmit={onChangePassword} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 14, color: "#334155" }}>Mat khau cu</label>
            <input
              type={showPassword ? "text" : "password"}
              value={passwordForm.old_password}
              onChange={(e) => setPasswordForm((prev) => ({ ...prev, old_password: e.target.value }))}
              placeholder="Nhap mat khau cu"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 14, color: "#334155" }}>Mat khau moi</label>
            <input
              type={showPassword ? "text" : "password"}
              value={passwordForm.new_password}
              onChange={(e) => setPasswordForm((prev) => ({ ...prev, new_password: e.target.value }))}
              placeholder="Nhap mat khau moi"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 14, color: "#334155" }}>Xac nhan mat khau</label>
            <input
              type={showPassword ? "text" : "password"}
              value={passwordForm.confirm_password}
              onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm_password: e.target.value }))}
              placeholder="Nhap lai mat khau moi"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            style={{ padding: 8, border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", color: "#334155", cursor: "pointer" }}
          >
            {showPassword ? "An mat khau" : "Hien mat khau"}
          </button>
          <button
            type="submit"
            disabled={changingPassword}
            style={{ padding: 10, border: "none", borderRadius: 8, background: "#0b5fff", color: "#fff" }}
          >
            {changingPassword ? "Dang doi..." : "Doi mat khau"}
          </button>
        </form>
      </div>
    </div>
  );
}
