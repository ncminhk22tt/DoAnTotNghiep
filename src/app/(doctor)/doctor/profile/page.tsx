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
  role: "patient" | "doctor" | "admin";
  status: "active" | "inactive" | "banned";
  created_at: string;
  description?: string | null;
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
    description: "",
  });

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
        description: res.data.description || "",
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

      showToast("Cap nhat ho so bac si thanh cong", "success");
      await loadProfile();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Cap nhat ho so that bai", "error");
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

  useEffect(() => {
    loadProfile();
  }, []);

  if (loading) return <p>Dang tai ho so bac si...</p>;
  if (!profile) return <p>Khong co du lieu ho so.</p>;

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, maxWidth: 680 }}>
      <h2 style={{ marginTop: 0 }}>Ho so bac si</h2>
      <p style={{ marginTop: 0, color: "#475569" }}>
        Username: <strong>{profile.username}</strong> | Role: <strong>{profile.role}</strong>
      </p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          value={form.full_name}
          onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
          placeholder="Ho va ten bac si"
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
        <textarea
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          placeholder="Mo ta bac si"
          rows={5}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #cbd5e1", resize: "vertical" }}
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
  );
}
