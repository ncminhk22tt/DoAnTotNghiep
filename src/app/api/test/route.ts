import { db } from "@/lib/db";

export async function GET() {
  const [rows] = await db.query("SELECT * FROM users LIMIT 5");

  return Response.json(rows);
}
