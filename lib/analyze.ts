import type { KeywordRow, PageInfo, RawRanking, ViewSpec } from "./types";

export function normUrl(u: string) {
  try {
    const x = new URL(u.startsWith("http") ? u : `https://${u}`);
    x.hash = "";
    let s = `${x.hostname.replace(/^www\./, "")}${x.pathname}`.replace(/\/+$/, "");
    if (x.search) s += x.search;
    return s.toLowerCase();
  } catch {
    return u.toLowerCase().replace(/\/+$/, "");
  }
}

export function fullUrl(u: string) {
  return u.startsWith("http") ? u : `https://${u}`;
}

/** Group raw (keyword, url, position) rows into one row per keyword with competing URLs. */
export function buildRows(raw: RawRanking[]): KeywordRow[] {
  const byKw = new Map<string, RawRanking[]>();
  for (const r of raw) {
    if (!r.keyword || !r.ranking_page) continue;
    const k = r.keyword.trim().toLowerCase();
    (byKw.get(k) ?? byKw.set(k, []).get(k)!).push(r);
  }
  const rows: KeywordRow[] = [];
  for (const [, list] of byKw) {
    list.sort((a, b) => (a.rank_position ?? 999) - (b.rank_position ?? 999));
    const top = list[0];
    const seen = new Set([normUrl(top.ranking_page)]);
    const competing = [];
    for (const r of list.slice(1)) {
      const n = normUrl(r.ranking_page);
      if (seen.has(n)) continue;
      seen.add(n);
      competing.push({ url: r.ranking_page, position: r.rank_position });
    }
    rows.push({
      keyword: top.keyword,
      topUrl: top.ranking_page,
      position: top.rank_position,
      volume: list.reduce<number | null>((m, r) => (r.volume != null ? Math.max(m ?? 0, r.volume) : m), null),
      difficulty: top.difficulty,
      cannibalized: competing.length > 0,
      competing,
    });
  }
  rows.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
  return rows;
}

const has = (s: string, needles?: string[]) =>
  !needles?.length || needles.some((n) => s.includes(n.toLowerCase()));

export function applyView(rows: KeywordRow[], pages: Record<string, PageInfo>, v: ViewSpec): KeywordRow[] {
  let out = rows.filter((r) => {
    const kw = r.keyword.toLowerCase();
    const urls = [r.topUrl, ...r.competing.map((c) => c.url)].join(" ").toLowerCase();
    const pa = pages[normUrl(r.topUrl)]?.pageAuthority ?? null;
    if (v.cannibalized === true && !r.cannibalized) return false;
    if (v.cannibalized === false && r.cannibalized) return false;
    if (!has(kw, v.keyword_contains)) return false;
    if (v.keyword_excludes?.length && v.keyword_excludes.some((x) => kw.includes(x.toLowerCase()))) return false;
    if (!has(urls, v.url_contains)) return false;
    if (v.min_volume != null && (r.volume ?? 0) < v.min_volume) return false;
    if (v.max_volume != null && (r.volume ?? 0) > v.max_volume) return false;
    if (v.min_position != null && (r.position ?? 999) < v.min_position) return false;
    if (v.max_position != null && (r.position ?? 999) > v.max_position) return false;
    if (v.min_pa != null && (pa ?? 0) < v.min_pa) return false;
    if (v.min_competing_urls != null && r.competing.length < v.min_competing_urls) return false;
    return true;
  });
  if (v.sort_field) {
    const dir = v.sort_dir === "asc" ? 1 : -1;
    const val = (r: KeywordRow): number | string => {
      switch (v.sort_field) {
        case "volume": return r.volume ?? -1;
        case "position": return r.position ?? 999;
        case "difficulty": return r.difficulty ?? -1;
        case "competing": return r.competing.length;
        case "pa": return pages[normUrl(r.topUrl)]?.pageAuthority ?? -1;
        default: return r.keyword;
      }
    };
    out = [...out].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }
  if (v.limit) out = out.slice(0, v.limit);
  return out;
}

export function describeView(v: ViewSpec): string[] {
  const c: string[] = [];
  if (v.cannibalized === true) c.push("Cannibalized only");
  if (v.cannibalized === false) c.push("Not cannibalized");
  if (v.keyword_contains?.length) c.push(`Keyword has: ${v.keyword_contains.join(" / ")}`);
  if (v.keyword_excludes?.length) c.push(`Excludes: ${v.keyword_excludes.join(" / ")}`);
  if (v.url_contains?.length) c.push(`URL has: ${v.url_contains.join(" / ")}`);
  if (v.min_volume != null) c.push(`Volume ≥ ${v.min_volume}`);
  if (v.max_volume != null) c.push(`Volume ≤ ${v.max_volume}`);
  if (v.min_position != null) c.push(`Position ≥ ${v.min_position}`);
  if (v.max_position != null) c.push(`Position ≤ ${v.max_position}`);
  if (v.min_pa != null) c.push(`PA ≥ ${v.min_pa}`);
  if (v.min_competing_urls != null) c.push(`≥ ${v.min_competing_urls} competing URLs`);
  if (v.sort_field) c.push(`Sorted by ${v.sort_field} ${v.sort_dir ?? "desc"}`);
  if (v.limit) c.push(`Top ${v.limit}`);
  return c;
}

/** Page-level index used by the topic checker. */
export function pageIndex(rows: KeywordRow[], pages: Record<string, PageInfo>) {
  const idx = new Map<string, { url: string; title: string | null; keywords: { k: string; v: number | null; p: number | null }[] }>();
  const add = (url: string, k: string, v: number | null, p: number | null) => {
    const n = normUrl(url);
    const e = idx.get(n) ?? { url, title: pages[n]?.title ?? null, keywords: [] };
    e.keywords.push({ k, v, p });
    idx.set(n, e);
  };
  for (const r of rows) {
    add(r.topUrl, r.keyword, r.volume, r.position);
    for (const c of r.competing) add(c.url, r.keyword, r.volume, c.position);
  }
  return [...idx.values()].map((e) => ({
    ...e,
    keywords: e.keywords.sort((a, b) => (b.v ?? 0) - (a.v ?? 0)).slice(0, 25),
  }));
}

export function toCsv(rows: KeywordRow[], pages: Record<string, PageInfo>) {
  const head = [
    "Keyword", "Top Ranking URL", "Page Title", "Date Published", "Monthly Search Volume",
    "Position", "Inbound Links", "Page Authority", "Cannibalization (Yes/No)", "Cannibalized URLs",
  ];
  const esc = (x: unknown) => {
    const s = x == null ? "" : String(x);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(",")];
  for (const r of rows) {
    const p = pages[normUrl(r.topUrl)];
    lines.push(
      [
        r.keyword, fullUrl(r.topUrl), p?.title, p?.datePublished, r.volume, r.position,
        p?.inboundLinks, p?.pageAuthority, r.cannibalized ? "Yes" : "No",
        r.competing.map((c) => `${fullUrl(c.url)} (#${c.position ?? "?"})`).join(" | "),
      ].map(esc).join(",")
    );
  }
  return lines.join("\n");
}
