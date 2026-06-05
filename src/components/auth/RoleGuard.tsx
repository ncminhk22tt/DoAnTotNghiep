"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { getAuthUser } from "@/lib/authClient";
import { UserRole } from "@/types/frontend-auth";

type RoleGuardProps = {
  allow: UserRole;
  children: React.ReactNode;
};

export function RoleGuard({ allow, children }: RoleGuardProps) {
  const router = useRouter();
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const user = isClient ? getAuthUser() : null;

  useEffect(() => {
    if (!isClient) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    if (user.role !== allow) {
      if (user.role === "admin") router.replace("/admin");
      else if (user.role === "doctor") router.replace("/doctor");
      else router.replace("/patient");
    }
  }, [allow, isClient, router, user]);

  if (!isClient || !user || user.role !== allow) {
    return <div style={{ padding: 24 }}>Đang kiểm tra quyền truy cập...</div>;
  }

  return <>{children}</>;
}
