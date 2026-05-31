import { NextResponse } from "next/server";
import { db, dbConfig } from "@/lib/db";

export async function GET() {
  try {
    const [rows] = await db.query("SELECT 1 AS ok");
    return NextResponse.json(
      {
        connected: true,
        dbHost: dbConfig.host,
        dbName: dbConfig.database,
        result: rows,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        message: "Cannot connect to local database",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
