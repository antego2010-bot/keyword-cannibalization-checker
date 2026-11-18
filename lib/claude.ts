export class ClaudeError extends Error {
  status: number;
  constructor(msg: string, status = 502) {
    super(msg);
    this.status = status;
  }
}

export const DEFAULT_MODEL = "claude-sonnet-4-5";

/** Calls Claude and forces a single tool call, returning the tool input as structured JSON. */
export async function claudeTool<T>(opts: {
  apiKey: string;
  model?: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  tool: { name: string; description: string; input_schema: object };
  maxTokens?: number;
}): Promise<T> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 2000,
      system: opts.system,
      messages: opts.messages,
      tools: [opts.tool],
      tool_choice: { type: "tool", name: opts.tool.name },
    }),
    cache: "no-store",
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    throw new ClaudeError(`Claude API: ${msg}`, res.status);
  }
  const block = json?.content?.find((b: any) => b.type === "tool_use");
  if (!block) throw new ClaudeError("Claude did not return a structured answer");
  return block.input as T;
}
