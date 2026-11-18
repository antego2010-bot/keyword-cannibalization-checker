import { NextResponse } from "next/server";
import { urlMetrics } from "@/lib/moz";
import { pageMeta } from "@/lib/pagemeta";
import { fail, requireHeader } from "@/lib/http";
import type { PageInfo } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const token = requireHeader(req, "x-moz-token", "Moz API token");
    const { urls } = (await req.json()) as { urls: string[] };
    if (!Array.isArray(urls) || !urls.length) return NextResponse.json({ pages: [] });
    const batch = urls.slice(0, 12);
    const pages: PageInfo[] = await Promise.all(
      batch.map(async (raw) => {
        const url = raw.startsWith("http") ? raw : `https://${raw}`;
        const [m, meta] = await Promise.all([
          urlMetrics(token, url).catch((e: Error) => ({ error: e.message })),
          pageMeta(url),
        ]);
        const metrics = "error" in m ? { pageAuthority: null, inboundLinks: null, linkingDomains: null } : m;
        return {
          url: raw,
          title: meta.title,
          datePublished: meta.datePublished,
          ...metrics,
          ...("error" in m ? { error: m.error } : {}),
        };
      })
    );
    return NextResponse.json({ pages });
  } catch (e) {
    return fail(e);
  }
}
