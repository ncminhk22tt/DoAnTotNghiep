import crypto from "crypto";
import { db } from "@/lib/db";
import { generateRefreshToken, JWTPayload } from "@/lib/jwt";
import { ResultSetHeader, RowDataPacket } from "mysql2";

interface SessionRow extends RowDataPacket {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function addDays(days: number): Date {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return now;
}

export async function issueRefreshToken(
  user: JWTPayload,
  ip?: string | null,
  userAgent?: string | null
): Promise<string> {
  const jti = crypto.randomUUID();
  const token = generateRefreshToken(user, jti);
  const tokenHash = sha256(token);
  const expiresAt = addDays(Number(process.env.REFRESH_TOKEN_DAYS) || 14);

  await db.execute<ResultSetHeader>(
    `INSERT INTO auth_refresh_tokens (user_id, token_hash, jti, expires_at, revoked_at, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, NOW())`,
    [user.id, tokenHash, jti, expiresAt, ip ?? null, userAgent ?? null]
  );

  return token;
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = sha256(rawToken);
  await db.execute<ResultSetHeader>(
    "UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL",
    [tokenHash]
  );
}

export async function validateRefreshToken(rawToken: string): Promise<SessionRow | null> {
  const tokenHash = sha256(rawToken);
  const [rows] = await db.execute<SessionRow[]>(
    `SELECT id, user_id, token_hash, expires_at, revoked_at
     FROM auth_refresh_tokens
     WHERE token_hash = ?
     LIMIT 1`,
    [tokenHash]
  );
  if (rows.length === 0) return null;

  const session = rows[0];
  if (session.revoked_at) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  return session;
}

export async function revokeAllUserRefreshTokens(userId: number): Promise<void> {
  await db.execute<ResultSetHeader>(
    "UPDATE auth_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
    [userId]
  );
}

