import { RowDataPacket } from "mysql2";

// Body tao/sua service
export type ServiceBody = {
  name?: unknown;
  specialty_id?: unknown;
  description?: unknown;
  logo_url?: unknown;
};

// Du lieu service doc tu DB
export interface ServiceRow extends RowDataPacket {
  id: number;
  name: string;
  specialty_id: number;
  specialty_name?: string;
  description: string | null;
  logo_url?: string | null;
}
