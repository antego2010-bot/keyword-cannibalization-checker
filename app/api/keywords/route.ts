import { NextResponse } from "next/server";
import { rankingKeywordsPage } from "@/lib/moz";
import { fail, requireHeader } from "@/lib/http";

export const maxDuration = 60;

const SCOPES = ["domain", "subdomain", "subfolder", "url"];
const LOCALES = ["en-US", "en-GB", "en-CA", "en-AU"];

export async function POST(req: Request) {
  try {
    const token = requireHeader(req, "x-moz-token", "Moz API token");
    const body = await req.json();
    const query = String(body.query || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!query) return NextResponse.json({ error: "Enter a domain or URL" }, { status: 400 });
    const scope = SCOPES.includes(body.scope) ? body.scope : "domain";
    const locale = LOCALES.includes(body.locale) ? body.locale : "en-US";
    const page = Math.max(0, Number(body.page) || 0);
    const limit = Math.min(500, Math.max(1, Number(body.limit) || 500));
    const rows = await rankingKeywordsPage(token, query, scope, locale, page, limit);
    return NextResponse.json({ rows, page, done: rows.length < limit });
  } catch (e) {
    return fail(e);
  }
}
