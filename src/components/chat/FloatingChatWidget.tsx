"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { getAccessToken, getAuthUser } from "@/lib/authClient";
import styles from "./FloatingChatWidget.module.css";
import { ChatMessageContent } from "./ChatMessageContent";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type ChatResponse = {
  data?: {
    answer?: string;
  };
};

type DoctorDetail = {
  doctor_id: number;
  doctor_code: string | null;
  full_name: string;
  specialty_name: string | null;
  experience: number | null;
  description: string | null;
};

type Slot = {
  id: number;
  start_time: string;
  end_time: string;
  status: "available" | "full" | "closed";
};

type Service = {
  id: number;
  name: string;
  description: string | null;
  specialty_id: number | null;
  specialty_name: string | null;
};

type DoctorLite = {
  doctor_id: number;
  full_name: string;
  specialty_name: string | null;
  experience: number | null;
  doctor_code: string | null;
};

const INITIAL_MESSAGE: ChatMessage = {
  role: "assistant",
  content:
    "Xin chao, toi la tro ly AI cua phong kham. Ban co the dat cau hoi bat ky de duoc ho tro.",
  createdAt: new Date().toISOString(),
};

const MAX_HISTORY_MESSAGES = 80;

function nowIso() {
  return new Date().toISOString();
}

function formatMessageTime(iso: string) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function findFirstHref(content: string, prefix: string) {
  const regex = new RegExp(`\\[[^\\]]+\\]\\((\\/[^)]+)\\)`, "g");
  for (const match of content.matchAll(regex)) {
    const href = match[1];
    if (href.startsWith(prefix)) return href;
  }
  return null;
}

function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<ChatMessage>;
    if (row.role !== "user" && row.role !== "assistant") continue;
    if (typeof row.content !== "string") continue;
    const content = row.content.trim();
    if (!content) continue;
    out.push({
      role: row.role,
      content: content.slice(0, 4000),
      createdAt: typeof row.createdAt === "string" && row.createdAt ? row.createdAt : nowIso(),
    });
  }
  return out.slice(-MAX_HISTORY_MESSAGES);
}

function readHistory(key: string): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    return sanitizeHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeHistory(key: string, data: ChatMessage[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(data.slice(-MAX_HISTORY_MESSAGES)));
  } catch {
    // ignore write error
  }
}

function buildInitialMessage(): ChatMessage {
  return { ...INITIAL_MESSAGE, createdAt: nowIso() };
}

export function FloatingChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHint, setLoadingHint] = useState<string>("");
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const messageRef = useRef<HTMLDivElement | null>(null);

  const hidden = pathname?.startsWith("/admin") || pathname?.startsWith("/doctor");
  const canSend = useMemo(() => draft.trim().length > 0 && !sending, [draft, sending]);
  const latestAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant") || null;
  const firstBookHref = latestAssistantMessage ? findFirstHref(latestAssistantMessage.content, "/dat-lich?") : null;
  const firstDoctorHref = latestAssistantMessage ? findFirstHref(latestAssistantMessage.content, "/bac-si/") : null;

  useEffect(() => {
    const user = getAuthUser("patient");
    const key = `chat_history:patient:${user?.id ?? "guest"}:widget`;
    setHistoryKey(key);
    const saved = readHistory(key);
    setMessages(saved.length ? saved : [INITIAL_MESSAGE]);
    setHistoryReady(true);
  }, []);

  useEffect(() => {
    if (!historyReady || !historyKey) return;
    writeHistory(historyKey, messages);
  }, [historyKey, historyReady, messages]);

  useEffect(() => {
    const handleOpenWidget = () => setOpen(true);
    window.addEventListener("open-ai-chat-widget", handleOpenWidget as EventListener);
    return () => {
      window.removeEventListener("open-ai-chat-widget", handleOpenWidget as EventListener);
    };
  }, []);

  if (hidden) return null;

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messageRef.current) {
        messageRef.current.scrollTop = messageRef.current.scrollHeight;
      }
    });
  }

  function pushAssistantMessage(content: string) {
    setMessages((prev) => [...prev, { role: "assistant", content, createdAt: nowIso() }]);
    scrollToBottom();
  }

  function pushUserMessage(content: string) {
    setMessages((prev) => [...prev, { role: "user", content, createdAt: nowIso() }]);
    scrollToBottom();
  }

  function next7Dates() {
    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      out.push(`${y}-${m}-${day}`);
    }
    return out;
  }

  function buildTimeRanges(slots: Slot[]) {
    if (!slots.length) return [] as Array<{ start: string; end: string }>;
    const sorted = [...slots].sort((a, b) => a.start_time.localeCompare(b.start_time));
    const ranges: Array<{ start: string; end: string }> = [];
    let start = sorted[0].start_time;
    let end = sorted[0].end_time;
    for (let i = 1; i < sorted.length; i += 1) {
      const current = sorted[i];
      if (current.start_time === end) {
        end = current.end_time;
      } else {
        ranges.push({ start, end });
        start = current.start_time;
        end = current.end_time;
      }
    }
    ranges.push({ start, end });
    return ranges;
  }

  function formatDateVi(ymd: string) {
    const d = new Date(`${ymd}T00:00:00`);
    return new Intl.DateTimeFormat("vi-VN", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    }).format(d);
  }

  async function showDoctorScheduleInChat(doctorId: number, serviceId: number | null) {
    try {
      setLoadingHint("Dang tim lich bac si...");
      pushAssistantMessage("Dang tai thong tin bac si va lich kham...");
      const detailRes = await apiClient.get<{ data: DoctorDetail }>(`/api/public/doctors/${doctorId}`);
      const doctor = detailRes.data;
      if (!doctor) throw new Error("Không tìm thấy thông tin bác sĩ.");

      const schedules = await Promise.all(
        next7Dates().map(async (date) => {
          const params = new URLSearchParams();
          params.set("date", date);
          if (serviceId) params.set("service_id", String(serviceId));
          const res = await apiClient.get<{ data: Slot[] }>(`/api/public/doctors/${doctorId}/schedule?${params.toString()}`);
          return { date, slots: res.data || [] };
        })
      );

      const lines: string[] = [];
      lines.push(`ten: ${doctor.full_name}${doctor.doctor_code ? ` (${doctor.doctor_code})` : ""}`);
      lines.push(`khoa: ${doctor.specialty_name || "-"}`);
      lines.push(`mo ta: ${doctor.description || "-"}`);
      lines.push(`kinh nghiem: ${doctor.experience ? `${doctor.experience} nam` : "-"}`);
      lines.push("Lich kham 7 ngay toi (bam vao khoang gio de xem chi tiet):");

      for (const item of schedules) {
        const availableSlots = item.slots.filter((s) => s.status !== "closed");
        if (!availableSlots.length) {
          lines.push(`- ${formatDateVi(item.date)}: Không có lịch`);
          continue;
        }
        const ranges = buildTimeRanges(availableSlots);
        const links = ranges.map((r) => {
          const params = new URLSearchParams();
          params.set("date", item.date);
          params.set("from", r.start.slice(0, 5));
          params.set("to", r.end.slice(0, 5));
          if (serviceId) params.set("service_id", String(serviceId));
          return `[${r.start.slice(0, 5)}-${r.end.slice(0, 5)}](/lich/${doctorId}?${params.toString()})`;
        });
        lines.push(`- ${formatDateVi(item.date)}: ${links.join(" | ")}`);
      }

      pushAssistantMessage(lines.join("\n"));
    } catch (error) {
      pushAssistantMessage(error instanceof Error ? error.message : "Không thể tải lịch bác sĩ.");
    } finally {
      setLoadingHint("");
    }
  }

  async function showRangeDetailInChat(doctorId: number, date: string, from: string, to: string, serviceId: number | null) {
    try {
      setLoadingHint("Dang kiem tra slot trong...");
      pushAssistantMessage("Dang tai cac khung gio chi tiet...");
      const params = new URLSearchParams();
      params.set("date", date);
      if (serviceId) params.set("service_id", String(serviceId));

      const slotRes = await apiClient.get<{ data: Slot[] }>(`/api/public/doctors/${doctorId}/schedule?${params.toString()}`);
      const selected = (slotRes.data || []).filter(
        (s) => s.status !== "closed" && s.start_time.slice(0, 5) >= from && s.end_time.slice(0, 5) <= to
      );

      const lines: string[] = [];
      lines.push(`Khung gio chi tiet ${formatDateVi(date)} (${from}-${to}):`);
      if (!selected.length) {
        lines.push("Không có slot chi tiết trong khoảng giờ này.");
      } else {
        for (const slot of selected) {
          if (slot.status === "available") {
            lines.push(`- [${slot.start_time.slice(0, 5)}-${slot.end_time.slice(0, 5)} - Dat lich ngay](/dat-lich?slot_id=${slot.id})`);
          } else {
            lines.push(`- ${slot.start_time.slice(0, 5)}-${slot.end_time.slice(0, 5)} (${slot.status})`);
          }
        }
      }
      pushAssistantMessage(lines.join("\n"));
    } catch (error) {
      pushAssistantMessage(error instanceof Error ? error.message : "Không thể tải khung giờ chi tiết.");
    } finally {
      setLoadingHint("");
    }
  }

  async function showServiceInfoInChat(serviceId: number) {
    try {
      setLoadingHint("Dang tai thong tin dich vu...");
      pushAssistantMessage("Dang tai thong tin dich vu...");
      const servicesRes = await apiClient.get<{ data: Service[] }>("/api/public/services");
      const service = (servicesRes.data || []).find((x) => x.id === serviceId) || null;
      if (!service) throw new Error("Không tìm thấy dịch vụ này.");

      const doctorsRes = await apiClient.get<{ data: DoctorLite[] }>(`/api/public/doctors?service_id=${serviceId}`);
      const doctors = doctorsRes.data || [];
      const lines: string[] = [];
      lines.push(`Thong tin dich vu: ${service.name}`);
      lines.push(`Khoa: ${service.specialty_name || "-"}${service.specialty_id ? ` (ID ${service.specialty_id})` : ""}`);
      if (service.description) lines.push(`Mo ta: ${service.description}`);
      if (!doctors.length) {
        lines.push("Hien chua co bac si cho dich vu nay.");
      } else {
        lines.push("Bac si phu hop:");
        for (const d of doctors.slice(0, 10)) {
          const link = `/bac-si/${d.doctor_id}?service_id=${serviceId}`;
          lines.push(`- [${d.full_name}](${link})`);
        }
      }
      pushAssistantMessage(lines.join("\n"));
    } catch (error) {
      pushAssistantMessage(error instanceof Error ? error.message : "Không thể tải thông tin dịch vụ.");
    } finally {
      setLoadingHint("");
    }
  }

  async function showServiceAndDoctorScheduleInChat(serviceId: number, doctorId: number) {
    try {
      setLoadingHint("Dang tai thong tin dich vu va lich kham...");
      pushAssistantMessage("Dang tai thong tin dich vu va lich kham...");

      const servicesRes = await apiClient.get<{ data: Service[] }>("/api/public/services");
      const service = (servicesRes.data || []).find((x) => x.id === serviceId) || null;
      if (!service) throw new Error("Khong tim thay dich vu nay.");

      const detailRes = await apiClient.get<{ data: DoctorDetail }>(`/api/public/doctors/${doctorId}`);
      const doctor = detailRes.data;
      if (!doctor) throw new Error("Khong tim thay thong tin bac si.");

      const schedules = await Promise.all(
        next7Dates().map(async (date) => {
          const params = new URLSearchParams();
          params.set("date", date);
          params.set("service_id", String(serviceId));
          const res = await apiClient.get<{ data: Slot[] }>(`/api/public/doctors/${doctorId}/schedule?${params.toString()}`);
          return { date, slots: res.data || [] };
        })
      );

      const lines: string[] = [];
      lines.push(`Dich vu kham: ${service.name}`);
      lines.push(`Mo ta: ${service.description || "-"}`);
      lines.push(`Lich kham trong tuan cua bac si ${doctor.full_name}:`);

      for (const item of schedules) {
        const availableSlots = item.slots.filter((s) => s.status !== "closed");
        if (!availableSlots.length) {
          lines.push(`- ${formatDateVi(item.date)}: Hien tai chua co lich`);
          continue;
        }

        const ranges = buildTimeRanges(availableSlots);
        const links = ranges.map((r) => {
          const params = new URLSearchParams();
          params.set("date", item.date);
          params.set("from", r.start.slice(0, 5));
          params.set("to", r.end.slice(0, 5));
          params.set("service_id", String(serviceId));
          return `[${r.start.slice(0, 5)}-${r.end.slice(0, 5)}](/lich/${doctorId}?${params.toString()})`;
        });
        lines.push(`- ${formatDateVi(item.date)}: ${links.join(" | ")}`);
      }

      pushAssistantMessage(lines.join("\n"));
    } catch (error) {
      pushAssistantMessage(error instanceof Error ? error.message : "Khong the tai thong tin dich vu.");
    } finally {
      setLoadingHint("");
    }
  }

  async function bookAppointmentInChat(slotId: number) {
    try {
      setLoadingHint("Dang dat lich...");
      const token = getAccessToken("patient");
      if (!token) {
      pushAssistantMessage("Vui lòng đăng nhập bệnh nhân để đặt lịch.");
        return;
      }
      await apiClient.post("/api/patient/appointments", { slot_id: slotId, note: "Dat tu chatbox AI" }, token);
      pushAssistantMessage("Dat lich thanh cong. Xem tai [/patient/appointments](/patient/appointments).");
    } catch (error) {
      pushAssistantMessage(`Dat lich that bai: ${error instanceof Error ? error.message : "Loi he thong"}`);
    } finally {
      setLoadingHint("");
    }
  }

  function showReviewOptionsInChat(appointmentId: number) {
    pushAssistantMessage(
      [
        `Danh gia lich #${appointmentId}:`,
        `- [5 sao](/gui-danh-gia?appointment_id=${appointmentId}&rating=5)`,
        `- [4 sao](/gui-danh-gia?appointment_id=${appointmentId}&rating=4)`,
        `- [3 sao](/gui-danh-gia?appointment_id=${appointmentId}&rating=3)`,
        `- [2 sao](/gui-danh-gia?appointment_id=${appointmentId}&rating=2)`,
        `- [1 sao](/gui-danh-gia?appointment_id=${appointmentId}&rating=1)`,
      ].join("\n")
    );
  }

  async function submitReviewInChat(appointmentId: number, rating: number) {
    try {
      setLoadingHint("Dang gui danh gia...");
      const token = getAccessToken("patient");
      if (!token) {
        pushAssistantMessage("Vui long dang nhap benh nhan de gui danh gia.");
        return;
      }
      await apiClient.post("/api/patient/reviews", { appointment_id: appointmentId, rating, comment: null }, token);
      pushAssistantMessage("Cam on ban. Danh gia da duoc ghi nhan thanh cong.");
    } catch (error) {
      pushAssistantMessage(`Gui danh gia that bai: ${error instanceof Error ? error.message : "Loi he thong"}`);
    } finally {
      setLoadingHint("");
    }
  }

  async function requestAdminSupport() {
    try {
      setLoadingHint("Dang gui yeu cau ho tro...");
      const user = getAuthUser("patient");
      const token = getAccessToken("patient");
      if (!user || !token) {
        pushAssistantMessage("Vui long dang nhap benh nhan de gui yeu cau ho tro.");
        return;
      }
      const lastUserQuestion = [...messages].reverse().find((m) => m.role === "user")?.content || null;
      await apiClient.post("/api/patient/support-request", { note: "Yeu cau tu chatbox", last_user_question: lastUserQuestion }, token);
      pushAssistantMessage("Da gui yeu cau ho tro den admin. Vui long cho trong it phut.");
    } catch (error) {
      pushAssistantMessage(error instanceof Error ? error.message : "Không thể gửi yêu cầu hỗ trợ.");
    } finally {
      setLoadingHint("");
    }
  }

  function handleChatLinkClick(href: string) {
    const doctorMatch = href.match(/^\/bac-si\/(\d+)(?:\?(.*))?$/);
    if (doctorMatch) {
      const doctorId = Number(doctorMatch[1]);
      if (!Number.isFinite(doctorId) || doctorId <= 0) return true;
      const q = new URLSearchParams(doctorMatch[2] || "");
      const rawService = Number(q.get("service_id"));
      const serviceId = Number.isFinite(rawService) && rawService > 0 ? rawService : null;
      void showDoctorScheduleInChat(doctorId, serviceId);
      return true;
    }

    const serviceMatch = href.match(/^\/dich-vu\/(\d+)(?:\?(.*))?$/);
    if (serviceMatch) {
      const serviceId = Number(serviceMatch[1]);
      if (!Number.isFinite(serviceId) || serviceId <= 0) return true;
      const q = new URLSearchParams(serviceMatch[2] || "");
      const rawDoctor = Number(q.get("doctor_id"));
      const doctorId = Number.isFinite(rawDoctor) && rawDoctor > 0 ? rawDoctor : null;
      if (doctorId) {
        void showServiceAndDoctorScheduleInChat(serviceId, doctorId);
      } else {
        void showServiceInfoInChat(serviceId);
      }
      return true;
    }

    const rangeMatch = href.match(/^\/lich\/(\d+)\?(.*)$/);
    if (rangeMatch) {
      const doctorId = Number(rangeMatch[1]);
      if (!Number.isFinite(doctorId) || doctorId <= 0) return true;
      const q = new URLSearchParams(rangeMatch[2] || "");
      const date = q.get("date") || "";
      const from = q.get("from") || "";
      const to = q.get("to") || "";
      const rawService = Number(q.get("service_id"));
      const serviceId = Number.isFinite(rawService) && rawService > 0 ? rawService : null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
        return true;
      }
      void showRangeDetailInChat(doctorId, date, from, to, serviceId);
      return true;
    }

    const bookMatch = href.match(/^\/dat-lich\?(.*)$/);
    if (bookMatch) {
      const q = new URLSearchParams(bookMatch[1] || "");
      const slotId = Number(q.get("slot_id"));
      if (!Number.isFinite(slotId) || slotId <= 0) return true;
      void bookAppointmentInChat(slotId);
      return true;
    }

    const reviewOpenMatch = href.match(/^\/danh-gia\?(.*)$/);
    if (reviewOpenMatch) {
      const q = new URLSearchParams(reviewOpenMatch[1] || "");
      const appointmentId = Number(q.get("appointment_id"));
      if (!Number.isFinite(appointmentId) || appointmentId <= 0) return true;
      showReviewOptionsInChat(appointmentId);
      return true;
    }

    const reviewSubmitMatch = href.match(/^\/gui-danh-gia\?(.*)$/);
    if (reviewSubmitMatch) {
      const q = new URLSearchParams(reviewSubmitMatch[1] || "");
      const appointmentId = Number(q.get("appointment_id"));
      const rating = Number(q.get("rating"));
      if (!Number.isFinite(appointmentId) || appointmentId <= 0) return true;
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) return true;
      void submitReviewInChat(appointmentId, rating);
      return true;
    }

    if (href === "/ho-tro/admin") {
      void requestAdminSupport();
      return true;
    }

    return false;
  }

  async function submitQuestion(content: string) {
    if (!content || sending) return;
    pushUserMessage(content);
    setSending(true);
    setLoadingHint("Dang phan tich cau hoi...");

    try {
      const user = getAuthUser("patient");
      const token = getAccessToken("patient");
      if (!user || !token) {
        pushAssistantMessage("Ban can dang nhap tai khoan benh nhan de su dung chat AI.");
        return;
      }

      const started = performance.now();
      const payloadMessages = [...messages, { role: "user" as const, content, createdAt: nowIso() }].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await apiClient.post<ChatResponse>("/api/patient/ai-chat", { messages: payloadMessages }, token);
      const elapsed = Math.max(1, Math.round(performance.now() - started));
      setLastLatencyMs(elapsed);

      const answer = res?.data?.answer?.trim() || "Xin loi, toi chua the tra loi luc nay. Vui long thu lai sau.";
      pushAssistantMessage(answer);
      setConsecutiveFailures(0);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Không thể gửi tin nhắn";
      pushAssistantMessage(msg);
      const nextFailures = consecutiveFailures + 1;
      setConsecutiveFailures(nextFailures);
      if (nextFailures >= 2) {
        pushAssistantMessage("Neu can nhanh, bam [Gui yeu cau ho tro admin](/ho-tro/admin).");
      }
    } finally {
      setSending(false);
      setLoadingHint("");
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setDraft("");
    await submitQuestion(content);
  }

  function reloadChatHistory() {
    if (!historyKey) return;
    const fresh = [buildInitialMessage()];
    writeHistory(historyKey, fresh);
    setMessages(fresh);
    setDraft("");
    setConsecutiveFailures(0);
    setLastLatencyMs(null);
    setLoadingHint("");
    scrollToBottom();
  }

  return (
    <div className={styles.wrapper}>
      {open ? (
        <section className={styles.panel}>
          <header className={styles.header}>
            <div>
              <h3 className={styles.title}>Tro ly AI</h3>
              <div className={styles.statusRow}>
                <span className={styles.onlineDot} />
                <span>Đang trực tuyến</span>
                <span className={styles.separator}>|</span>
                <span>{lastLatencyMs ? `Phản hồi ~${lastLatencyMs} mili giây` : "Sẵn sàng hỗ trợ"}</span>
              </div>
            </div>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.reloadBtn}
                onClick={reloadChatHistory}
                disabled={sending}
                aria-label="Tao moi doan chat"
                title="Tao moi doan chat"
              >
                <span className={styles.reloadIcon} aria-hidden="true">
                  ↻
                </span>
              </button>
              <button type="button" className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Dong chat">
                x
              </button>
            </div>
          </header>

          <div className={styles.messages} ref={messageRef}>
            {messages.map((message, index) => (
              <div key={`message-${index}`} className={styles.messageWrap}>
                <div className={`${styles.bubble} ${message.role === "assistant" ? styles.assistant : styles.user}`}>
                  <ChatMessageContent content={message.content} onLinkClick={handleChatLinkClick} />
                </div>
                <div className={`${styles.time} ${message.role === "assistant" ? styles.timeLeft : styles.timeRight}`}>
                  {formatMessageTime(message.createdAt)}
                </div>
              </div>
            ))}

            {sending ? (
              <div className={styles.messageWrap}>
                <div className={`${styles.bubble} ${styles.assistant}`}>
                  {loadingHint ? <div className={styles.loadingHint}>{loadingHint}</div> : null}
                  <span className={styles.typingDots} aria-label="AI dang tra loi">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {(firstBookHref || firstDoctorHref) && !sending ? (
            <div className={styles.stickyActions}>
              {firstBookHref ? (
                <button type="button" className={styles.stickyPrimary} onClick={() => void handleChatLinkClick(firstBookHref)}>
                  Dat nhanh
                </button>
              ) : null}
              {firstDoctorHref ? (
                <button type="button" className={styles.stickySecondary} onClick={() => void handleChatLinkClick(firstDoctorHref)}>
                  Xem bac si
                </button>
              ) : null}
            </div>
          ) : null}

          <form className={styles.composer} onSubmit={handleSend}>
            <div className={styles.inputRow}>
              <input
                type="text"
                className={styles.input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Nhap cau hoi..."
              />
              <button type="submit" className={styles.sendBtn} disabled={!canSend}>
                {sending ? "Dang gui..." : "Gui"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <button type="button" className={styles.fab} aria-label="Mo chatbox AI" onClick={() => setOpen((value) => !value)}>
        AI
      </button>
    </div>
  );
}
