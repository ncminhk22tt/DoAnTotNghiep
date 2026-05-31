import { RowDataPacket } from "mysql2";

export interface ScheduleSlot extends RowDataPacket {
  id: number;
  doctor_id: number;
  service_id: number;
  service_name?: string | null;
  work_date: string;
  start_time: string;
  end_time: string;
  room: string | null;
  price: number;
  max_patients: number;
  booked_count: number;
  status: "available" | "full" | "closed";
}
