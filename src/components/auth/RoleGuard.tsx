"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthUser } from "@/lib/authClient";
import { UserRole } from "@/types/frontend-auth";

type RoleGuardProps = {
  allow: UserRole;
  children: React.ReactNode;
};

export function RoleGuard({ allow, children }: RoleGuardProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<ReturnType<typeof getAuthUser>>(null);

  useEffect(() => {
    setMounted(true);
    setUser(getAuthUser());
  }, []);

  useEffect(() => {
    if (!mounted) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    if (user.role !== allow) {
      if (user.role === "admin") router.replace("/admin");
      else if (user.role === "doctor") router.replace("/doctor");
      else router.replace("/patient");
    }
  }, [allow, mounted, router, user]);

  if (!mounted || !user || user.role !== allow) {
    return <div style={{ padding: 24 }}>Đang kiểm tra quyền truy cập...</div>;
  }

  return <>{children}</>;
}
