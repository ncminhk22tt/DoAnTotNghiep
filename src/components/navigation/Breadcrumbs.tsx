"use client";

import Link from "next/link";
import styles from "./Breadcrumbs.module.css";

export type BreadcrumbItem = {
  label: string;
  href?: string;
  home?: boolean;
};

type Props = {
  items: BreadcrumbItem[];
};

function HomeIcon() {
  return (
    <svg className={styles.homeIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3.6 3 11.2h2.3V20h6.2v-4.8h1V20h6.2v-8.8H21L12 3.6z" />
    </svg>
  );
}

export function Breadcrumbs({ items }: Props) {
  return (
    <nav className={styles.nav} aria-label="Breadcrumb">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const key = `${item.label}-${index}`;

        return (
          <span key={key} className={styles.itemWrap}>
            {index > 0 ? <span className={styles.sep}>/</span> : null}
            {!isLast && item.href ? (
              <Link className={styles.link} href={item.href}>
                {item.home ? <HomeIcon /> : item.label}
              </Link>
            ) : (
              <span className={styles.current}>
                {item.home ? <HomeIcon /> : item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
