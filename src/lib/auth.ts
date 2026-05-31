import type { AuthUser, UserRole } from "@/types/frontend-auth";

export type AuthRole = UserRole;

const STORAGE_PREFIX = "mb_";
const ROLE_STORAGE_KEYS: AuthRole[] = ["admin", "doctor", "patient"];

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeRole(role?: string | null): AuthRole | null {
  if (role === "admin" || role === "doctor" || role === "patient") {
    return role;
  }

  return null;
}

function getRoleKey(role: AuthRole, suffix: string): string {
  return `${STORAGE_PREFIX}${suffix}_${role}`;
}

function readJson<T>(key: string): T | null {
  if (!isBrowser()) {
    return null;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readString(key: string): string | null {
  if (!isBrowser()) {
    return null;
  }

  return window.localStorage.getItem(key);
}

export function getActiveRole(): AuthRole | null {
  if (!isBrowser()) {
    return null;
  }

  return normalizeRole(window.localStorage.getItem(`${STORAGE_PREFIX}active_role`));
}

export function getAuthUser(role?: AuthRole): AuthUser | null {
  if (!isBrowser()) {
    return null;
  }

  const targetRole = role ?? getActiveRole();
  if (targetRole) {
    const user = readJson<AuthUser>(getRoleKey(targetRole, "auth_user"));
    if (user) {
      return user;
    }
  }

  for (const fallbackRole of ROLE_STORAGE_KEYS) {
    const user = readJson<AuthUser>(getRoleKey(fallbackRole, "auth_user"));
    if (user) {
      return user;
    }
  }

  return null;
}

export function getAccessToken(role?: AuthRole): string | null {
  if (!isBrowser()) {
    return null;
  }

  const targetRole = role ?? getActiveRole();
  if (targetRole) {
    const token = readString(getRoleKey(targetRole, "access_token"));
    if (token) {
      return token;
    }
  }

  for (const fallbackRole of ROLE_STORAGE_KEYS) {
    const token = readString(getRoleKey(fallbackRole, "access_token"));
    if (token) {
      return token;
    }
  }

  return null;
}

export function getRefreshToken(role?: AuthRole): string | null {
  if (!isBrowser()) {
    return null;
  }

  const targetRole = role ?? getActiveRole();
  if (targetRole) {
    const token = readString(getRoleKey(targetRole, "refresh_token"));
    if (token) {
      return token;
    }
  }

  for (const fallbackRole of ROLE_STORAGE_KEYS) {
    const token = readString(getRoleKey(fallbackRole, "refresh_token"));
    if (token) {
      return token;
    }
  }

  return null;
}

export function setAuthSession(options: {
  role: AuthRole;
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}): void {
  if (!isBrowser()) {
    return;
  }

  const { role, user, accessToken, refreshToken } = options;
  window.localStorage.setItem(`${STORAGE_PREFIX}active_role`, role);
  window.localStorage.setItem(getRoleKey(role, "auth_user"), JSON.stringify(user));
  window.localStorage.setItem(getRoleKey(role, "access_token"), accessToken);
  window.localStorage.setItem(getRoleKey(role, "refresh_token"), refreshToken);
}

export function clearAuthSession(role?: AuthRole): void {
  if (!isBrowser()) {
    return;
  }

  const targetRole = role ?? getActiveRole();
  if (targetRole) {
    window.localStorage.removeItem(getRoleKey(targetRole, "auth_user"));
    window.localStorage.removeItem(getRoleKey(targetRole, "access_token"));
    window.localStorage.removeItem(getRoleKey(targetRole, "refresh_token"));
  }

  window.localStorage.removeItem(`${STORAGE_PREFIX}active_role`);
}
