"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./users.module.css";

type PatientUser = {
  id: number;
  username: string;
  full_name: string;
  role: string;
  status: "active" | "inactive" | "banned";
  created_at: string;
};

export default function AdminUsersPage() {
  const { showToast } = useToast();
  const [users, setUsers] = useState<PatientUser[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const token = getAccessToken();
      const res = await apiClient.get<{ data: PatientUser[] }>("/api/admin/users", token);
      setUsers(res.data || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Không tải được danh sách";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(userId: number, status: "active" | "inactive") {
    try {
      const token = getAccessToken();
      await apiClient.patch(`/api/admin/users/${userId}`, { status }, token);
      await loadUsers();
      showToast("Cập nhật trạng thái thành công", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Cập nhật thất bại", "error");
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  if (loading) return <p>Đang tải danh sách người dùng...</p>;
  if (error) return <p className={styles.errorText}>{error}</p>;

  function getStatusLabel(status: PatientUser["status"]) {
    if (status === "active") return "Đang hoạt động";
    if (status === "inactive") return "Tạm khóa";
    return "Bị cấm";
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Quản lý người dùng (patient)</h2>

      <div className={styles.listContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Username</th>
              <th className={styles.th}>Họ tên</th>
              <th className={styles.th}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={styles.td}>{u.username}</td>
                <td className={styles.td}>{u.full_name}</td>
                <td className={styles.td}>
                  <div className={styles.statusWrap}>
                    <span
                      className={`${styles.statusBadge} ${
                        u.status === "active" ? styles.statusActive : styles.statusInactive
                      }`}
                    >
                      {getStatusLabel(u.status)}
                    </span>
                    {u.status === "active" ? (
                      <button
                        onClick={() => updateStatus(u.id, "inactive")}
                        className={styles.secondaryBtn}
                      >
                        Tạm khóa
                      </button>
                    ) : (
                      <button
                        onClick={() => updateStatus(u.id, "active")}
                        className={styles.primaryBtn}
                      >
                        Kích hoạt
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
