export type UserRole = "patient" | "doctor" | "admin";

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  token: string;
  refresh_token: string;
  user: AuthUser;
}

