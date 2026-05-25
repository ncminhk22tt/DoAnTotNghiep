import { AuthUser, UserRole } from "@/types/frontend-auth";

const ACCESS_TOKEN_KEY = "mb_access_token";
const REFRESH_TOKEN_KEY = "mb_refresh_token";
const AUTH_USER_KEY = "mb_auth_user";
const ACTIVE_ROLE_KEY = "mb_active_role";

function isBrowser() {
  return typeof window !== "undefined";
}

function roleAccessTokenKey(role: UserRole) {
  return `${ACCESS_TOKEN_KEY}_${role}`;
}

function roleRefreshTokenKey(role: UserRole) {
  return `${REFRESH_TOKEN_KEY}_${role}`;
}

function roleAuthUserKey(role: UserRole) {
  return `${AUTH_USER_KEY}_${role}`;
}

function roleFromPathname(pathname: string): UserRole | null {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/doctor")) return "doctor";
  if (pathname.startsWith("/patient")) return "patient";
  return null;
}

function hasSessionByRole(role: UserRole) {
  if (!isBrowser()) return false;
  return !!localStorage.getItem(roleAuthUserKey(role));
}

function isRole(value: string | null | undefined): value is UserRole {
  return value === "admin" || value === "doctor" || value === "patient";
}

function clearLegacySharedKeys() {
  if (!isBrowser()) return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

export function getActiveRole(): UserRole | null {
  if (!isBrowser()) return null;
  const active = localStorage.getItem(ACTIVE_ROLE_KEY);
  return isRole(active) ? active : null;
}

export function setActiveRole(role: UserRole) {
  if (!isBrowser()) return;
  localStorage.setItem(ACTIVE_ROLE_KEY, role);
}

export function getAllAuthUsers(): AuthUser[] {
  if (!isBrowser()) return [];
  const users: AuthUser[] = [];
  (["patient", "doctor", "admin"] as UserRole[]).forEach((role) => {
    const raw = localStorage.getItem(roleAuthUserKey(role));
    if (!raw) return;
    try {
      users.push(JSON.parse(raw) as AuthUser);
    } catch {
      // Ignore bad localStorage value
    }
  });
  return users;
}

function resolveRole(role?: UserRole): UserRole | null {
  if (!isBrowser()) return role ?? null;
  if (role) return role;

  const fromPath = roleFromPathname(window.location.pathname);
  if (fromPath) return fromPath;

  // Public pages must only use patient session.
  if (hasSessionByRole("patient")) return "patient";
  return null;
}

export function setAuthSession(accessToken: string, refreshToken: string, user: AuthUser) {
  if (!isBrowser()) return;

  // Keep isolated auth by role to avoid cross-tab overwrite.
  localStorage.setItem(roleAccessTokenKey(user.role), accessToken);
  localStorage.setItem(roleRefreshTokenKey(user.role), refreshToken);
  localStorage.setItem(roleAuthUserKey(user.role), JSON.stringify(user));
  setActiveRole(user.role);

  // Hard-clean old shared keys so public pages do not pick wrong role.
  clearLegacySharedKeys();
}

export function clearAuthSession(role?: UserRole) {
  if (!isBrowser()) return;

  const resolvedRole = resolveRole(role);
  if (resolvedRole) {
    localStorage.removeItem(roleAccessTokenKey(resolvedRole));
    localStorage.removeItem(roleRefreshTokenKey(resolvedRole));
    localStorage.removeItem(roleAuthUserKey(resolvedRole));

    const active = getActiveRole();
    if (active === resolvedRole) {
      localStorage.removeItem(ACTIVE_ROLE_KEY);
    }
  } else if (role) {
    localStorage.removeItem(roleAccessTokenKey(role));
    localStorage.removeItem(roleRefreshTokenKey(role));
    localStorage.removeItem(roleAuthUserKey(role));
  } else {
    (["admin", "doctor", "patient"] as UserRole[]).forEach((r) => {
      localStorage.removeItem(roleAccessTokenKey(r));
      localStorage.removeItem(roleRefreshTokenKey(r));
      localStorage.removeItem(roleAuthUserKey(r));
    });
    localStorage.removeItem(ACTIVE_ROLE_KEY);
  }

  clearLegacySharedKeys();
}

export function clearAllAuthSessions() {
  clearAuthSession(undefined);
}

export function getAccessToken(role?: UserRole) {
  if (!isBrowser()) return null;
  const resolvedRole = resolveRole(role);
  if (!resolvedRole) return null;
  return localStorage.getItem(roleAccessTokenKey(resolvedRole));
}

export function getRefreshToken(role?: UserRole) {
  if (!isBrowser()) return null;
  const resolvedRole = resolveRole(role);
  if (!resolvedRole) return null;
  return localStorage.getItem(roleRefreshTokenKey(resolvedRole));
}

export function getAuthUser(role?: UserRole): AuthUser | null {
  if (!isBrowser()) return null;
  const resolvedRole = resolveRole(role);
  if (!resolvedRole) return null;
  const raw = localStorage.getItem(roleAuthUserKey(resolvedRole));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function hasRole(role: UserRole) {
  const user = getAuthUser(role);
  return user?.role === role;
}
