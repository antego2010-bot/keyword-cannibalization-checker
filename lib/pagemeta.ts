function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, attr: "property" | "name" | "itemprop", key: string) {
  const re1 = new RegExp(`<meta[^>]*${attr}=["']${key}["'][^>]*content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attr}=["']${key}["']`, "i");
  return html.match(re1)?.[1] ?? html.match(re2)?.[1] ?? null;
}

function normaliseDate(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function pageMeta(url: string): Promise<{ title: string | null; datePublished: string | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KeywordCannibalizationChecker/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });
    if (!res.ok || !res.body) return { title: null, datePublished: null };
    // read at most ~400KB
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 400_000) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    const html = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));

    const rawTitle =
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? metaContent(html, "property", "og:title");
    const title = rawTitle ? decode(rawTitle) : null;

    let date =
      metaContent(html, "property", "article:published_time") ??
      metaContent(html, "itemprop", "datePublished") ??
      metaContent(html, "name", "date") ??
      metaContent(html, "name", "publish-date") ??
      metaContent(html, "name", "parsely-pub-date") ??
      html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] ??
      html.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] ??
      null;

    return { title, datePublished: normaliseDate(date) };
  } catch {
    return { title: null, datePublished: null };
  } finally {
    clearTimeout(t);
  }
}
