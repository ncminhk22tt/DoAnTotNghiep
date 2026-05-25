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
    title: "Lich hen",
    desc: "Xem lich da dat, trang thai va chi tiet buoi kham.",
    href: "/patient/appointments",
    cta: "Mo lich hen",
  },
  {
    key: "records",
    title: "Ket qua kham",
    desc: "Xem chan doan, don thuoc va ket qua kham gan day.",
    href: "/patient/medical-records",
    cta: "Xem ket qua",
  },
  {
    key: "profile",
    title: "Ho so ca nhan",
    desc: "Cap nhat thong tin lien he va thong tin benh nhan.",
    href: "/patient/profile",
    cta: "Cap nhat ho so",
  },
  {
    key: "chatbox",
    title: "Chatbox AI",
    desc: "Hoi dap nhanh ve dat lich, quy trinh kham va huong dan su dung he thong.",
    action: "open-chat-widget",
    cta: "Mo chatbox",
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
