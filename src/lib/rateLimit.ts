import { db } from "@/lib/db";
import { RowDataPacket } from "mysql2";

type BucketState = {
  request_count: number;
  window_start_ms: number;
};

type InMemoryBucket = {
  count: number;
  resetAt: number;
};

const fallbackBuckets = new Map<string, InMemoryBucket>();

interface RateLimitRow extends RowDataPacket, BucketState {}

let tableReady = false;
let preparing: Promise<void> | null = null;

async function ensureRateLimitTable() {
  if (tableReady) return;
  if (preparing) {
    await preparing;
    return;
  }

  preparing = (async () => {
    const [tables] = await db.query<RowDataPacket[]>("SHOW TABLES LIKE 'rate_limit_buckets'");
    if (tables.length === 0) {
      throw new Error("Database schema not ready: missing rate_limit_buckets table");
    }
    tableReady = true;
  })();

  try {
    await preparing;
  } finally {
    preparing = null;
  }
}

function fallbackConsumeRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const state = fallbackBuckets.get(bucketKey);

  if (!state || state.resetAt <= now) {
    fallbackBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (state.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((state.resetAt - now) / 1000)),
    };
  }

  state.count += 1;
  fallbackBuckets.set(bucketKey, state);
  return { allowed: true, retryAfterSec: 0 };
}

export function getClientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0].trim();
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}

export async function consumeRateLimit(
  bucketKey: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  try {
    await ensureRateLimitTable();

    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;

    await db.execute(
      `INSERT INTO rate_limit_buckets (bucket_key, window_start_ms, request_count, updated_at)
       VALUES (?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
         request_count = IF(window_start_ms = VALUES(window_start_ms), request_count + 1, 1),
         window_start_ms = VALUES(window_start_ms),
         updated_at = NOW()`,
      [bucketKey, windowStart]
    );

    const [rows] = await db.execute<RateLimitRow[]>(
      `SELECT request_count, window_start_ms
       FROM rate_limit_buckets
       WHERE bucket_key = ?
       LIMIT 1`,
      [bucketKey]
    );

    if (rows.length === 0) {
      return { allowed: true, retryAfterSec: 0 };
    }

    const bucket = rows[0];
    if (bucket.request_count <= limit) {
      return { allowed: true, retryAfterSec: 0 };
    }

    const resetAt = Number(bucket.window_start_ms) + windowMs;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  } catch {
    // Fail open with in-memory fallback when DB is unavailable.
    return fallbackConsumeRateLimit(bucketKey, limit, windowMs);
  }
}

