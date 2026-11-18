import { NextResponse } from "next/server";
import { claudeTool } from "@/lib/claude";
import { fail, requireHeader } from "@/lib/http";
import type { ViewSpec } from "@/lib/types";

export const maxDuration = 60;

const numOrNull = { type: ["number", "null"] };
const strArr = { type: "array", items: { type: "string" } };

const TOOL = {
  name: "set_table_view",
  description:
    "Reply to the user and set how the keyword table is filtered and sorted. Always set every filter field; use null or [] for filters that should be off. Filters replace (not add to) the current view unless the user is clearly refining it.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "Short, friendly answer (1-4 sentences). Can include insight from the stats provided." },
      view: {
        type: "object",
        properties: {
          cannibalized: { type: ["boolean", "null"], description: "true = only cannibalized keywords, false = only clean ones, null = all" },
          keyword_contains: { ...strArr, description: "Keep keywords containing ANY of these substrings" },
          keyword_excludes: { ...strArr, description: "Drop keywords containing any of these" },
          url_contains: { ...strArr, description: "Keep rows where top or competing URL contains ANY of these (e.g. '/blog/')" },
          min_volume: numOrNull, max_volume: numOrNull,
          min_position: numOrNull, max_position: numOrNull,
          min_pa: numOrNull,
          min_competing_urls: { ...numOrNull, description: "Minimum number of competing (cannibalizing) URLs" },
          sort_field: { type: ["string", "null"], enum: ["volume", "position", "pa", "competing", "keyword", "difficulty", null] },
          sort_dir: { type: ["string", "null"], enum: ["asc", "desc", null] },
          limit: numOrNull,
        },
        required: [
          "cannibalized", "keyword_contains", "keyword_excludes", "url_contains", "min_volume", "max_volume",
          "min_position", "max_position", "min_pa", "min_competing_urls", "sort_field", "sort_dir", "limit",
        ],
      },
    },
    required: ["reply", "view"],
  },
};

export async function POST(req: Request) {
  try {
    const apiKey = requireHeader(req, "x-anthropic-key", "Claude API key");
    const model = req.headers.get("x-claude-model") || undefined;
    const { messages, context, currentView } = await req.json();
    const system = `You are the assistant inside a Keyword Cannibalization Checker built on Moz API data.
The user is looking at a table of keywords a site ranks for. Columns: keyword, top ranking URL, page title, date published, monthly volume, position, inbound links, page authority (PA), cannibalized (yes/no), competing URLs.
A keyword is "cannibalized" when 2+ URLs from the same site rank for it.
You cannot see every row; you control the table through the set_table_view tool and the app shows the matching rows.
Dataset summary:
${JSON.stringify(context)}
Current view: ${JSON.stringify(currentView ?? {})}
Be concise and practical. If a request can't be expressed as a filter, say what you did instead.`;
    const out = await claudeTool<{ reply: string; view: ViewSpec }>({
      apiKey,
      model,
      system,
      messages: (messages as { role: "user" | "assistant"; content: string }[]).slice(-12),
      tool: TOOL,
      maxTokens: 1200,
    });
    return NextResponse.json(out);
  } catch (e) {
    return fail(e);
  }
}
