import { db } from "@/lib/db";
import { ResultSetHeader } from "mysql2";
import { ensureAuditLogTable } from "@/lib/auditLogSchema";

type AuditPayload = {
  user_id?: number | null;
  action: string;
  entity_type?: string | null;
  entity_id?: number | null;
  status?: "success" | "failed";
  ip?: string | null;
  user_agent?: string | null;
  detail?: string | null;
};

export async function writeAuditLog(payload: AuditPayload): Promise<void> {
  try {
    await ensureAuditLogTable();
    await db.execute<ResultSetHeader>(
      `INSERT INTO audit_logs
      (user_id, action, entity_type, entity_id, status, ip_address, user_agent, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        payload.user_id ?? null,
        payload.action,
        payload.entity_type ?? null,
        payload.entity_id ?? null,
        payload.status ?? "success",
        payload.ip ?? null,
        payload.user_agent ?? null,
        payload.detail ?? null,
      ]
    );
  } catch {
    // Khong throw de trảnh lam hong luong chinh.
  }
}

