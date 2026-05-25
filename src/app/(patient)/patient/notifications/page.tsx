"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import styles from "./notifications.module.css";

type NotificationItem = {
  id: number;
  user_id: number;
  message: string;
  action_url: string | null;
  is_read: 0 | 1;
  created_at: string;
};

function resolvePatientDetailUrl(actionUrl: string | null) {
  if (!actionUrl) return "/patient/appointments";
  if (!actionUrl.startsWith("/")) return "/patient/appointments";

  // Patient area should not navigate into admin/doctor screens.
  if (actionUrl.startsWith("/admin") || actionUrl.startsWith("/doctor")) {
    return "/patient/appointments";
  }

  // Allow patient/public pages and notification detail pages.
  return actionUrl;
}

export default function PatientNotificationsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);

  async function loadNotifications() {
    try {
      setLoading(true);
      const token = getAccessToken();
      const query = unreadOnly ? "?unread=true" : "";
      const res = await apiClient.get<{ data: NotificationItem[] }>(`/api/notifications${query}`, token);
      setItems(res.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the tai thong bao", "error");
    } finally {
      setLoading(false);
    }
  }

  async function markOneRead(id: number) {
    try {
      const token = getAccessToken();
      await apiClient.patch(`/api/notifications/${id}`, {}, token);
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, is_read: 1 } : x)));
      showToast("Da danh dau thong bao", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the cap nhat thong bao", "error");
    }
  }

  async function openNotification(item: NotificationItem) {
    if (item.is_read === 0) {
      await markOneRead(item.id);
    }
    router.push(resolvePatientDetailUrl(item.action_url));
  }

  async function markAllRead() {
    try {
      const token = getAccessToken();
      await apiClient.patch("/api/notifications", {}, token);
      setItems((prev) => prev.map((x) => ({ ...x, is_read: 1 })));
      showToast("Da danh dau tat ca thong bao", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Khong the cap nhat thong bao", "error");
    }
  }

  useEffect(() => {
    loadNotifications();
  }, [unreadOnly]);

  const unreadCount = useMemo(() => items.filter((x) => x.is_read === 0).length, [items]);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Thong bao</h2>
      <div className={styles.toolbar}>
        <label className={styles.filter}>
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Chi hien thong bao chua doc
        </label>
        <button
          onClick={markAllRead}
          disabled={unreadCount === 0}
          className={styles.btnMarkAll}
        >
          Danh dau da doc tat ca ({unreadCount})
        </button>
      </div>

      {loading ? (
        <p className={styles.loading}>Dang tai thong bao...</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li
              key={item.id}
              className={`${styles.item} ${item.is_read ? "" : styles.itemUnread}`}
            >
              <div className={`${styles.message} ${item.is_read ? "" : styles.messageUnread}`}>{item.message}</div>
              <div className={styles.date}>{item.created_at}</div>
              <div className={styles.actions}>
                <button
                  onClick={() => openNotification(item)}
                  className={styles.btnPrimary}
                >
                  Mo chi tiet
                </button>
                {item.is_read === 0 ? (
                <button
                  onClick={() => markOneRead(item.id)}
                  className={styles.btnSecondary}
                >
                  Danh dau da doc
                </button>
                ) : null}
              </div>
            </li>
          ))}
          {items.length === 0 && <li className={styles.empty}>Khong co thong bao nao.</li>}
        </ul>
      )}
    </div>
  );
}
