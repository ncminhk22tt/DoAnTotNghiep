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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const user = getAuthUser();

    if (!user) {
      router.replace("/login");
      return;
    }

    if (user.role !== allow) {
      if (user.role === "admin") router.replace("/admin");
      else if (user.role === "doctor") router.replace("/doctor");
      else router.replace("/patient");
      return;
    }

    setReady(true);
  }, [allow, router]);

  if (!ready) {
    return <div style={{ padding: 24 }}>Đang kiểm tra quyền truy cập...</div>;
  }

  return <>{children}</>;
}
