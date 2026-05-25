import { RowDataPacket } from "mysql2";

// Role va trảng thai duoc dung xuyen suot trong he thong
export type UserRole = "patient" | "doctor" | "admin";
export type UserStatus = "active" | "inactive" | "banned";

// Kieu user doc tu bang users
export interface User extends RowDataPacket {
  id: number;
  username: string;
  password: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
}

// Body login tu client gui len
export interface LoginRequestBody {
  phone?: string;
  username?: string;
  password?: string;
}

// User trả ve cho frontend sau login
export interface LoginResponseUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
}

// Kieu specialty tong quat (co the dung cho man hinh danh sach)
export interface Specialty extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
}
