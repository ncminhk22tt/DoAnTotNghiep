"use client";

import { usePathname } from "next/navigation";
import { FloatingChatWidget } from "@/components/chat/FloatingChatWidget";
import { PublicHeader } from "@/components/layout/PublicHeader";

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isRoleArea = /^\/(admin|doctor|patient)(\/|$)/.test(pathname);

  return (
    <>
      {!isRoleArea ? <PublicHeader /> : null}
      {children}
      {!isRoleArea ? <FloatingChatWidget /> : null}
    </>
  );
}
