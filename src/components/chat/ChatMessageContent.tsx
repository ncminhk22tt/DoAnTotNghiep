"use client";

import React from "react";
import styles from "./ChatMessageContent.module.css";

type Segment =
  | { type: "text"; value: string }
  | { type: "link"; label: string; href: string };

const LINK_REGEX = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function parseMarkdownLinks(input: string): Segment[] {
  const text = input || "";
  const result: Segment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(LINK_REGEX)) {
    const full = match[0];
    const label = match[1];
    const href = match[2];
    const start = match.index ?? -1;
    if (start < 0) continue;

    if (start > lastIndex) {
      result.push({ type: "text", value: text.slice(lastIndex, start) });
    }

    result.push({ type: "link", label, href });
    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) {
    result.push({ type: "text", value: text.slice(lastIndex) });
  }

  return result.length > 0 ? result : [{ type: "text", value: text }];
}

function isSafeHref(href: string): boolean {
  return href.startsWith("/") || href.startsWith("http://") || href.startsWith("https://");
}

function renderTextWithBold(value: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let i = 0;

  while ((match = regex.exec(value)) !== null) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    if (start > lastIndex) {
      nodes.push(
        <React.Fragment key={`${keyPrefix}-plain-${i}`}>
          {value.slice(lastIndex, start)}
        </React.Fragment>
      );
      i += 1;
    }
    nodes.push(
      <strong key={`${keyPrefix}-bold-${i}`}>{match[1]}</strong>
    );
    i += 1;
    lastIndex = start + match[0].length;
  }

  if (lastIndex < value.length) {
    nodes.push(
      <React.Fragment key={`${keyPrefix}-tail-${i}`}>
        {value.slice(lastIndex)}
      </React.Fragment>
    );
  }

  return nodes.length > 0 ? nodes : value;
}

function renderSegments(
  value: string,
  keyPrefix: string,
  onLinkClick?: (href: string) => boolean
) {
  const segments = parseMarkdownLinks(value);
  return segments.map((segment, index) => {
    if (segment.type === "text") {
      return (
        <React.Fragment key={`${keyPrefix}-text-${index}`}>
          {renderTextWithBold(segment.value, `${keyPrefix}-text-${index}`)}
        </React.Fragment>
      );
    }

    if (!isSafeHref(segment.href)) {
      return <React.Fragment key={`${keyPrefix}-unsafe-${index}`}>{segment.label}</React.Fragment>;
    }

    const external = segment.href.startsWith("http://") || segment.href.startsWith("https://");
    return (
      <a
        key={`${keyPrefix}-link-${index}`}
        href={segment.href}
        className={styles.link}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer noopener" : undefined}
        onClick={(e) => {
          if (!onLinkClick) return;
          const handled = onLinkClick(segment.href);
          if (handled) {
            e.preventDefault();
          }
        }}
      >
        {segment.label}
      </a>
    );
  });
}

export function ChatMessageContent({
  content,
  onLinkClick,
}: {
  content: string;
  onLinkClick?: (href: string) => boolean;
}) {
  const lines = (content || "").split("\n");

  return (
    <div className={styles.text}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        const isBullet = trimmed.startsWith("- ") || trimmed.startsWith("* ");
        const value = isBullet ? trimmed.slice(2).trim() : line;
        if (!value) {
          return <div key={`line-${index}`} className={styles.lineSpacer} />;
        }
        if (isBullet) {
          return (
            <div key={`line-${index}`} className={styles.bulletCard}>
              {renderSegments(value, `line-${index}`, onLinkClick)}
            </div>
          );
        }
        return (
          <div key={`line-${index}`} className={styles.line}>
            {renderSegments(value, `line-${index}`, onLinkClick)}
          </div>
        );
      })}
    </div>
  );
}
