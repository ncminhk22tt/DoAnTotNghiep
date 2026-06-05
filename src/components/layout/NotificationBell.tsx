"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/authClient";
import { useToast } from "@/components/ui/ToastProvider";
import type { AuthUser } from "@/types/frontend-auth";
import styles from "./NotificationBell.module.css";

type NotificationItem = {
  id: number;
  user_id: number;
  message: string;
  action_url: string | null;
  is_read: 0 | 1;
  created_at: string;
};

function fallbackPathByRole(role: AuthUser["role"]) {
  if (role === "doctor") return "/doctor";
  if (role === "admin") return "/admin";
  return "/patient/notifications";
}

function allNotificationsPathByRole(role: AuthUser["role"]) {
  if (role === "patient") return "/patient/notifications";
  if (role === "doctor") return "/doctor";
  return "/admin";
}

function formatDisplayDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
  const [year, month, day] = date.split("-");
  const time = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);

  return `${day}-${month}-${year} ${time}`;
}

type NotificationBellProps = {
  user: AuthUser | null;
  showLabel?: boolean;
};

export function NotificationBell({ user, showLabel = false }: NotificationBellProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);

  async function loadNotifications() {
    if (!user) return;
    try {
      setLoading(true);
      const token = getAccessToken(user.role);
      if (!token) {
        setItems([]);
        return;
      }
      const response = await apiClient.get<{ data: NotificationItem[] }>("/api/notifications?limit=8", token);
      setItems(response.data || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Không thể tải thông báo", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 30000);
    return () => window.clearInterval(timer);
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!wrapRef.current || !target) return;
      if (!wrapRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const unreadCount = useMemo(() => items.filter((x) => x.is_read === 0).length, [items]);

  async function markAsRead(id: number) {
    if (!user) return;
    const token = getAccessToken(user.role);
    if (!token) return;
    await apiClient.patch(`/api/notifications/${id}`, {}, token);
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, is_read: 1 } : x)));
  }

  async function handleClickItem(item: NotificationItem) {
    if (!user) return;
    try {
      if (item.is_read === 0) {
        await markAsRead(item.id);
      }
    } catch {
      // Keep navigation even if mark-read failed.
    } finally {
      setOpen(false);
      router.push(item.action_url || fallbackPathByRole(user.role));
    }
  }

  if (!user) return null;

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={`${styles.bellButton} ${showLabel ? styles.bellButtonWithLabel : ""}`}
        aria-label="Thông báo"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (!open) loadNotifications();
        }}
      >
        <svg className={styles.bellIcon} viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2Z"
            fill="currentColor"
          />
        </svg>
        {showLabel ? <span className={styles.bellLabel}>Thông báo</span> : null}
        {unreadCount > 0 ? <span className={styles.badge}>{unreadCount}</span> : null}
      </button>

      {open ? (
        <div className={styles.popup}>
          <div className={styles.popupHeader}>
            <strong>Thông báo</strong>
            <button type="button" className={styles.refreshBtn} onClick={loadNotifications} disabled={loading}>
              Làm mới
            </button>
          </div>

          <div className={styles.list}>
            {loading ? <div className={styles.empty}>Đang tải...</div> : null}
            {!loading && items.length === 0 ? <div className={styles.empty}>Chưa có thông báo.</div> : null}
            {!loading &&
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.item} ${item.is_read ? "" : styles.itemUnread}`}
                  onClick={() => handleClickItem(item)}
                >
                  <div className={styles.message}>{item.message}</div>
                  <div className={styles.time}>{formatDisplayDateTime(item.created_at)}</div>
                </button>
              ))}
          </div>

          <button
            type="button"
            className={styles.viewAllBtn}
            onClick={() => {
              setOpen(false);
              router.push(allNotificationsPathByRole(user.role));
            }}
          >
            Xem tất cả
          </button>
        </div>
      ) : null}
    </div>
  );
}
