import { clearAuthSession, getAuthUser, getRefreshToken, setAuthSession } from "@/lib/authClient";
import type { UserRole } from "@/types/frontend-auth";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  retry?: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "";

async function tryRefreshToken(role: UserRole): Promise<string | null> {
  const refreshToken = getRefreshToken(role);
  if (!refreshToken) return null;

  const response = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  });

  if (!response.ok) {
    clearAuthSession(role);
    return null;
  }

  const payload = (await response.json().catch(() => ({}))) as {
    token?: string;
    refresh_token?: string;
    user?: { id?: number; username?: string; role?: UserRole };
  };

  if (!payload.token || !payload.refresh_token || !payload.user?.role) {
    clearAuthSession(role);
    return null;
  }

  const currentUser = getAuthUser(role);
  if (!currentUser) {
    clearAuthSession(role);
    return null;
  }

  setAuthSession(payload.token, payload.refresh_token, {
    ...currentUser,
    role: payload.user.role,
    id: payload.user.id ?? currentUser.id,
    username: payload.user.username ?? currentUser.username,
  });
  return payload.token;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, headers = {}, retry = false } = options;
  const response = await fetch(`${API_BASE}${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (response.status === 401 && token && !retry) {
    const currentUser = getAuthUser();
    const role = currentUser?.role;
    if (role) {
      const newToken = await tryRefreshToken(role);
      if (newToken) {
        return request<T>(url, { ...options, token: newToken, retry: true });
      }
    }
  }

  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };

  if (!response.ok) {
    const errorMessage = payload?.message || `Request failed: ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload;
}

export const apiClient = {
  get: <T>(url: string, token?: string | null) => request<T>(url, { method: "GET", token }),
  post: <T>(url: string, body?: unknown, token?: string | null) =>
    request<T>(url, { method: "POST", body, token }),
  put: <T>(url: string, body?: unknown, token?: string | null) =>
    request<T>(url, { method: "PUT", body, token }),
  patch: <T>(url: string, body?: unknown, token?: string | null) =>
    request<T>(url, { method: "PATCH", body, token }),
  delete: <T>(url: string, token?: string | null) => request<T>(url, { method: "DELETE", token }),
};
