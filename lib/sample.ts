import type { PageInfo, RawRanking } from "./types";

// Synthetic demo data so the UI can be explored without API keys. Not real Moz data.
const P = (path: string) => `example-seo.com${path}`;
const pagesSpec: [string, string, string, number, number][] = [
  ["/blog/what-is-domain-authority", "What Is Domain Authority? A Plain-English Guide", "2023-04-11", 58, 1320],
  ["/learn/domain-authority", "Domain Authority Explained", "2019-08-02", 64, 2810],
  ["/tools/domain-authority-checker", "Free Domain Authority Checker", "2021-01-15", 61, 1904],
  ["/blog/keyword-research-guide", "Keyword Research: The Complete Guide", "2022-06-20", 55, 980],
  ["/learn/keyword-research", "Keyword Research for Beginners", "2018-03-12", 59, 1544],
  ["/blog/internal-linking-tips", "17 Internal Linking Tips That Still Work", "2024-02-08", 47, 412],
  ["/learn/internal-links", "What Are Internal Links?", "2017-10-30", 52, 733],
  ["/blog/meta-description-length", "Meta Description Length in 2026", "2025-11-04", 44, 210],
  ["/blog/local-seo-checklist", "The Local SEO Checklist", "2024-09-18", 49, 388],
  ["/blog/ai-overviews-seo", "How AI Overviews Change SEO", "2025-07-01", 42, 260],
  ["/blog/generative-engine-optimization", "Generative Engine Optimization (GEO): A Starter Guide", "2025-03-22", 45, 301],
  ["/blog/backlink-audit", "How to Run a Backlink Audit", "2023-12-05", 50, 520],
  ["/tools/link-explorer", "Link Explorer: Backlink Checker", "2020-05-09", 63, 2201],
];
export const samplePages: Record<string, PageInfo> = {};
for (const [path, title, date, pa, links] of pagesSpec) {
  const url = P(path);
  samplePages[url.toLowerCase()] = { url, title, datePublished: date, pageAuthority: pa, inboundLinks: links, linkingDomains: Math.round(links / 7) };
}

const R = (keyword: string, volume: number, difficulty: number, ...ranks: [string, number][]): RawRanking[] =>
  ranks.map(([path, pos]) => ({ keyword, volume, difficulty, ranking_page: P(path), rank_position: pos }));

export const sampleRaw: RawRanking[] = [
  ...R("domain authority", 8100, 71, ["/learn/domain-authority", 2], ["/blog/what-is-domain-authority", 7], ["/tools/domain-authority-checker", 11]),
  ...R("domain authority checker", 6600, 66, ["/tools/domain-authority-checker", 1], ["/learn/domain-authority", 9]),
  ...R("what is domain authority", 2400, 58, ["/blog/what-is-domain-authority", 3], ["/learn/domain-authority", 5]),
  ...R("check da", 1900, 55, ["/tools/domain-authority-checker", 1]),
  ...R("keyword research", 14800, 78, ["/learn/keyword-research", 4], ["/blog/keyword-research-guide", 8]),
  ...R("how to do keyword research", 3600, 64, ["/blog/keyword-research-guide", 3], ["/learn/keyword-research", 6]),
  ...R("keyword research for beginners", 880, 52, ["/learn/keyword-research", 2]),
  ...R("internal links", 2900, 57, ["/learn/internal-links", 1], ["/blog/internal-linking-tips", 14]),
  ...R("internal linking best practices", 720, 49, ["/blog/internal-linking-tips", 2]),
  ...R("meta description length", 1600, 41, ["/blog/meta-description-length", 1]),
  ...R("local seo checklist", 1300, 46, ["/blog/local-seo-checklist", 3]),
  ...R("ai overviews seo", 1000, 48, ["/blog/ai-overviews-seo", 5], ["/blog/generative-engine-optimization", 12]),
  ...R("generative engine optimization", 2400, 53, ["/blog/generative-engine-optimization", 4], ["/blog/ai-overviews-seo", 18]),
  ...R("backlink checker", 18100, 82, ["/tools/link-explorer", 3], ["/blog/backlink-audit", 21]),
  ...R("backlink audit", 1300, 51, ["/blog/backlink-audit", 2]),
  ...R("link explorer", 900, 60, ["/tools/link-explorer", 1]),
];
