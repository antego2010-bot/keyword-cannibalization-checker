import { NextResponse } from "next/server";
import { claudeTool } from "@/lib/claude";
import { fail, requireHeader } from "@/lib/http";

export const maxDuration = 60;

type IndexedPage = { url: string; title: string | null; keywords: { k: string; v: number | null; p: number | null }[] };

const STOP = new Set("a an the of for to in on and or with how what why is are do does your you best guide vs".split(" "));
const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((t) => t.length > 1 && !STOP.has(t));

function score(page: IndexedPage, terms: string[]) {
  const hay = [page.title ?? "", page.url, ...page.keywords.map((k) => k.k)].join(" ").toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (t.includes(" ")) { if (hay.includes(t)) s += 3; continue; }
    if (hay.includes(t)) s += 1;
  }
  const kwHits = page.keywords.filter((k) => terms.some((t) => k.k.toLowerCase().includes(t))).length;
  return s + kwHits * 0.5;
}

export async function POST(req: Request) {
  try {
    const apiKey = requireHeader(req, "x-anthropic-key", "Claude API key");
    const model = req.headers.get("x-claude-model") || undefined;
    const { topic, site, pages } = (await req.json()) as { topic: string; site: string; pages: IndexedPage[] };
    if (!topic?.trim()) return NextResponse.json({ error: "Enter a topic" }, { status: 400 });

    // 1) Expand the topic into search terms so we catch synonyms (e.g. "GEO" ~ "AI search optimization")
    const exp = await claudeTool<{ terms: string[] }>({
      apiKey, model, maxTokens: 500,
      system: "You expand a content topic into terms an SEO would use to find existing pages about it.",
      messages: [{ role: "user", content: `Topic: "${topic}". Return 10-20 lowercase search terms and short phrases (synonyms, abbreviations, close subtopics, likely URL slugs words).` }],
      tool: {
        name: "terms", description: "Return expansion terms",
        input_schema: { type: "object", properties: { terms: { type: "array", items: { type: "string" } } }, required: ["terms"] },
      },
    });
    const terms = [...new Set([...tokens(topic), topic.toLowerCase().trim(), ...exp.terms.map((t) => t.toLowerCase().trim())])].filter(Boolean);

    // 2) Score every page the site ranks with, keep the best candidates
    const candidates = (pages || [])
      .map((p) => ({ p, s: score(p, terms) }))
      .filter((x) => x.s >= 1)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map(({ p }) => ({
        url: p.url,
        title: p.title,
        keywords: p.keywords.slice(0, 10).map((k) => `${k.k} (vol ${k.v ?? "?"}, #${k.p ?? "?"})`),
      }));

    // 3) Ask Claude for the decision
    const decision = await claudeTool<any>({
      apiKey, model, maxTokens: 2500,
      system: `You are a senior SEO content strategist. Decide whether a site should create a new page for a topic, refresh an existing page, or merge overlapping pages, based on the pages it already ranks with (from Moz ranking-keyword data).
Rules of thumb:
- create_new: no existing page meaningfully targets the topic's primary intent.
- refresh_existing: one page already targets it; improve/expand that page instead.
- merge: 2+ pages split the same intent (cannibalization); consolidate into the strongest URL and 301 the rest.
Only list pages from the candidate list. Be specific and practical.`,
      messages: [{
        role: "user",
        content: `Site: ${site}\nProposed topic: "${topic}"\nCandidate existing pages (${candidates.length}):\n${JSON.stringify(candidates, null, 1)}`,
      }],
      tool: {
        name: "content_decision",
        description: "Return the recommendation",
        input_schema: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["create_new", "refresh_existing", "merge"] },
            headline: { type: "string", description: "One-sentence recommendation" },
            reasoning: { type: "string", description: "2-4 sentences" },
            primary_url: { type: ["string", "null"], description: "The page to refresh, or the merge target" },
            merge_urls: { type: "array", items: { type: "string" }, description: "Pages to fold into primary_url (merge only)" },
            related_pages: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  url: { type: "string" }, title: { type: ["string", "null"] },
                  overlap: { type: "string", enum: ["high", "medium", "low"] },
                  why: { type: "string" },
                },
                required: ["url", "overlap", "why"],
              },
            },
            next_steps: { type: "array", items: { type: "string" } },
            target_keywords: { type: "array", items: { type: "string" }, description: "Keywords the new/refreshed page should target" },
          },
          required: ["verdict", "headline", "reasoning", "related_pages", "next_steps"],
        },
      },
    });
    return NextResponse.json({ ...decision, candidatesConsidered: candidates.length, terms });
  } catch (e) {
    return fail(e);
  }
}
