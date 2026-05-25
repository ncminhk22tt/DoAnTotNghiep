import { NextResponse } from "next/server";

export function ok<T>(data: T, message = "OK", status = 200) {
  return NextResponse.json(
    {
      success: true,
      message,
      data,
    },
    { status }
  );
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json(
    {
      success: false,
      message,
      ...(extra ?? {}),
    },
    { status }
  );
}

