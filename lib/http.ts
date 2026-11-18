import { NextResponse } from "next/server";

export function fail(err: unknown) {
  const e = err as { message?: string; status?: number };
  const status = e?.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  return NextResponse.json({ error: e?.message || "Unexpected error" }, { status });
}

export function requireHeader(req: Request, name: string, label: string) {
  const v = req.headers.get(name)?.trim();
  if (!v) {
    const err = new Error(`Missing ${label}. Add it in Settings.`) as Error & { status: number };
    err.status = 401;
    throw err;
  }
  return v;
}
