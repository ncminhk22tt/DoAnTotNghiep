"use client";

import Link from "next/link";
import styles from "./page.module.css";

type Shortcut = {
  key: string;
  title: string;
  desc: string;
  cta: string;
  href?: string;
  action?: "open-chat-widget";
};

const shortcuts: Shortcut[] = [
  {
    key: "appointments",
    title: "Lịch hẹn",
    desc: "Xem lịch đã đặt, trạng thái và chi tiết buổi khám.",
    href: "/patient/appointments",
    cta: "Mở lịch hẹn",
  },
  {
    key: "records",
    title: "Kết quả khám",
    desc: "Xem chẩn đoán, đơn thuốc và kết quả khám gần đây.",
    href: "/patient/medical-records",
    cta: "Xem kết quả",
  },
  {
    key: "profile",
    title: "Hồ sơ cá nhân",
    desc: "Cập nhật thông tin liên hệ và thông tin bệnh nhân.",
    href: "/patient/profile",
    cta: "Cập nhật hồ sơ",
  },
  {
    key: "chatbox",
    title: "Chatbox AI",
    desc: "Hỏi đáp nhanh về đặt lịch, quy trình khám và hướng dẫn sử dụng hệ thống.",
    action: "open-chat-widget",
    cta: "Mở chatbox",
  },
];

export default function PatientDashboardPage() {
  function openChatWidget() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("open-ai-chat-widget"));
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Cong benh nhan</h2>
      <p className={styles.subTitle}>Chon chuc nang ban can su dung.</p>

      <section className={styles.grid}>
        {shortcuts.map((item) => (
          <article key={item.key} className={styles.card}>
            <h3 className={styles.cardTitle}>{item.title}</h3>
            <p className={styles.cardDesc}>{item.desc}</p>
            {item.action === "open-chat-widget" ? (
              <button type="button" className={styles.cardBtn} onClick={openChatWidget}>
                {item.cta}
              </button>
            ) : (
              <Link className={styles.cardBtn} href={item.href || "/"}>
                {item.cta}
              </Link>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
