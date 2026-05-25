import { RowDataPacket } from "mysql2";

// Body tao/sua specialty gui tu client
export type SpecialtyBody = {
  name?: unknown;
  description?: unknown;
  logo_url?: unknown;
  head_doctor_user_id?: unknown;
  deputy_doctor_user_id?: unknown;
};

// Du lieu specialty doc tu database
export interface SpecialtyRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  logo_url?: string | null;
  head_doctor_user_id?: number | null;
  deputy_doctor_user_id?: number | null;
  head_doctor_name?: string | null;
  deputy_doctor_name?: string | null;
}
