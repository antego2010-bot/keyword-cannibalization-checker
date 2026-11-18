# Keyword Cannibalization Checker

Find the pages on your site that compete for the same keywords, then ask Claude whether to **create**, **refresh** or **merge** content before you write anything new.

Built on the [Moz API](https://moz.com/api) (ranking keywords, Page Authority, inbound links) and the [Claude API](https://console.anthropic.com).

## What it does

1. **Analyze a site.** Enter a domain, subdomain, subfolder or URL and a location. Moz pulls every keyword it ranks for. Any keyword where two or more of your URLs rank is flagged as cannibalized.
2. **See it in one table.** Keyword · Top ranking URL · Page title · Date published · Monthly volume · Position · Inbound links · Page Authority · Cannibalized (Yes/No) · Cannibalized URLs. Export the current view to CSV.
3. **Chat with your data.** "Show only cannibalized keywords", "cannibalized keywords over 1,000 searches", or "blog posts competing with /learn pages". Claude turns the request into a filter on the table.
4. **Check a new topic.** Type the topic you plan to write about. Claude searches every page you already rank with and recommends creating a new page, refreshing an existing one, or merging overlapping pages, with next steps.

## Bring your own keys

Each user adds their own **Moz API token** and **Claude API key** in Settings. Keys are saved in the browser's local storage and sent only to this app's API routes, which call Moz and Anthropic on the user's behalf. Nothing is stored server-side.

Moz charges quota per keyword returned, so start with 500 keywords.

## Where the data comes from

| Column | Source |
|---|---|
| Keyword, ranking URLs, position, volume | Moz `data.site.ranking-keyword.list` |
| Page Authority, inbound links | Moz `data.site.metrics.fetch` (scope `url`) |
| Page title, date published | Read from the page's HTML (`<title>`, `article:published_time`, JSON-LD `datePublished`) |
| Cannibalized? / Cannibalized URLs | Calculated: 2+ URLs from the site ranking for the same keyword |
| Chat filters, topic decision | Claude (tool use, structured output) |

## Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. Fork or import this repo into Vercel. It's a standard Next.js app, so no settings or environment variables are needed.
2. Open the deployed URL, click **Add API keys**, and paste your Moz and Claude keys.
3. Not ready yet? Click **Try it with sample data** to explore the interface.

## Run locally

```bash
npm install
npm run dev
```

## Project layout

```
app/page.tsx              UI (table, chat, topic checker, settings)
app/api/keywords          Moz ranking keywords (paged, 500 per call)
app/api/enrich            Moz URL metrics + page title/date for top URLs
app/api/chat              Claude → table filter spec
app/api/topic             Claude topic expansion → candidate pages → create/refresh/merge
lib/analyze.ts            Cannibalization grouping, filtering, CSV export
lib/moz.ts, lib/claude.ts API clients
```
