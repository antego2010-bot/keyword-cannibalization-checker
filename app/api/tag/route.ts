import { NextResponse } from "next/server";
import { claudeTool } from "@/lib/claude";
import { fail, requireHeader } from "@/lib/http";

export const maxDuration = 60;

// Fixed taxonomy so topic clusters stay consistent from month to month.
const CLUSTERS = [
  "SEO fundamentals", "Keyword research", "On-page SEO", "Technical SEO", "Site speed & Core Web Vitals",
  "Structured data & schema", "Link building", "Backlink analysis", "Domain & page authority metrics",
  "Local SEO", "International SEO", "Ecommerce SEO", "Mobile SEO", "Image & video SEO",
  "Content marketing", "Content strategy & planning", "Copywriting & content creation",
  "SERP features", "AI search & GEO", "Google algorithm updates", "Search engines & how they work",
  "Analytics & reporting", "Google Search Console", "Google Analytics", "Competitive research",
  "Rank tracking", "Agency & client SEO", "Enterprise SEO", "SEO careers & industry",
  "Social media marketing", "Paid search & PPC", "Conversion rate optimization", "Brand & PR",
  "Moz product & tools", "Moz company & events", "Other",
];

type PageIn = { u: string; title?: string; h1?: string; desc?: string; snip?: string };

export async function POST(req: Request) {
  try {
    const apiKey = requireHeader(req, "x-anthropic-key", "Claude API key");
    const model = req.headers.get("x-claude-model") || undefined;
    const { pages } = (await req.json()) as { pages: PageIn[] };
    const batch = (pages || []).slice(0, 30);
    const content = batch
      .map((p, i) => `[${i}] ${p.u}\nTitle: ${p.title ?? ""}\nH1: ${p.h1 ?? ""}\nMeta: ${p.desc ?? ""}\nOpening: ${(p.snip ?? "").slice(0, 450)}`)
      .join("\n\n");
    const out = await claudeTool<{ tags: { i: number; topic: string; cluster: string; intent: string; keyword: string }[] }>({
      apiKey, model, maxTokens: 4000,
      system: `You tag pages from moz.com for a content cannibalization inventory.
For each page return:
- topic: the page's primary topic as a short, normalized lowercase noun phrase (2-5 words) that another page on the SAME subject would also get. Use the generic subject, not the angle or format (e.g. "title tags", not "how to write title tags in 2019"; "domain authority", not "what's new with DA 2.0"). Use the same wording for the same subject every time.
- cluster: exactly one of: ${CLUSTERS.join(" | ")}
- intent: informational | commercial | transactional | navigational
- keyword: the main search query this page should rank for (lowercase).`,
      messages: [{ role: "user", content }],
      tool: {
        name: "tag_pages",
        description: "Return one tag object per page index",
        input_schema: {
          type: "object",
          properties: {
            tags: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  i: { type: "number" },
                  topic: { type: "string" },
                  cluster: { type: "string", enum: CLUSTERS },
                  intent: { type: "string", enum: ["informational", "commercial", "transactional", "navigational"] },
                  keyword: { type: "string" },
                },
                required: ["i", "topic", "cluster", "intent", "keyword"],
              },
            },
          },
          required: ["tags"],
        },
      },
    });
    const tags = out.tags.map((t) => ({ ...t, u: batch[t.i]?.u })).filter((t) => t.u);
    return NextResponse.json({ tags });
  } catch (e) {
    return fail(e);
  }
}
