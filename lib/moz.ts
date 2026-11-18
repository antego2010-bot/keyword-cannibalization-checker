import type { RawRanking } from "./types";

const MOZ_ENDPOINT = "https://api.moz.com/jsonrpc";

export class MozError extends Error {
  status: number;
  constructor(msg: string, status = 502) {
    super(msg);
    this.status = status;
  }
}

async function mozCall(token: string, method: string, data: unknown) {
  const res = await fetch(MOZ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-moz-token": token,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params: { data },
    }),
    cache: "no-store",
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new MozError(`Moz API returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status || 502);
  }
  if (json.error) {
    const msg = json.error.message || JSON.stringify(json.error);
    const status = res.status >= 400 ? res.status : 400;
    throw new MozError(`Moz API: ${msg}`, status);
  }
  if (!res.ok) throw new MozError(`Moz API HTTP ${res.status}`, res.status);
  return json.result;
}

export async function rankingKeywordsPage(
  token: string,
  query: string,
  scope: string,
  locale: string,
  page: number,
  limit = 500
): Promise<RawRanking[]> {
  const result = await mozCall(token, "data.site.ranking-keyword.list", {
    target_query: { query, scope, locale },
    options: { sort: "volume" },
    page: { n: page, limit },
  });
  const list = result?.ranking_keywords ?? [];
  return list.map((r: any) => ({
    keyword: String(r.keyword ?? ""),
    ranking_page: String(r.ranking_page ?? ""),
    rank_position: r.rank_position ?? null,
    volume: r.volume ?? null,
    difficulty: r.difficulty ?? null,
  }));
}

function pick(obj: any, keys: string[]): number | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
  }
  return null;
}

export async function urlMetrics(token: string, url: string) {
  const result = await mozCall(token, "data.site.metrics.fetch", {
    site_query: { query: url, scope: "url" },
  });
  const m = result?.site_metrics ?? result?.metrics ?? result;
  return {
    pageAuthority: pick(m, ["page_authority"]),
    inboundLinks: pick(m, ["external_pages_to_page", "pages_to_page"]),
    linkingDomains: pick(m, ["root_domains_to_page"]),
  };
}
