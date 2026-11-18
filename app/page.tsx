"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { applyView, buildRows, describeView, fullUrl, normUrl, pageIndex, toCsv } from "@/lib/analyze";
import { samplePages, sampleRaw } from "@/lib/sample";
import type { Keys, KeywordRow, PageInfo, RawRanking, ViewSpec } from "@/lib/types";

const DEFAULT_MODEL = "claude-sonnet-4-5";
const LS_KEYS = "kcc.keys.v1";

type Msg = { role: "user" | "assistant"; content: string };
type Decision = {
  verdict: "create_new" | "refresh_existing" | "merge";
  headline: string;
  reasoning: string;
  primary_url?: string | null;
  merge_urls?: string[];
  related_pages: { url: string; title?: string | null; overlap: "high" | "medium" | "low"; why: string }[];
  next_steps: string[];
  target_keywords?: string[];
  candidatesConsidered?: number;
};

function loadKeys(): Keys {
  try {
    const k = JSON.parse(localStorage.getItem(LS_KEYS) || "{}");
    return { mozToken: k.mozToken || "", anthropicKey: k.anthropicKey || "", model: k.model || DEFAULT_MODEL };
  } catch {
    return { mozToken: "", anthropicKey: "", model: DEFAULT_MODEL };
  }
}

async function api<T>(path: string, body: unknown, keys: Keys): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-moz-token": keys.mozToken,
      "x-anthropic-key": keys.anthropicKey,
      "x-claude-model": keys.model,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json as T;
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const shortUrl = (u: string) => u.replace(/^https?:\/\//, "").replace(/^www\./, "");
const pathOf = (u: string) => { const s = shortUrl(u); const i = s.indexOf("/"); return i >= 0 ? s.slice(i) || "/" : "/"; };

export default function Home() {
  const [keys, setKeys] = useState<Keys>({ mozToken: "", anthropicKey: "", model: DEFAULT_MODEL });
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => {
    const k = loadKeys();
    setKeys(k);
    if (!k.mozToken) setShowSettings(true);
  }, []);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("domain");
  const [locale, setLocale] = useState("en-US");
  const [maxKw, setMaxKw] = useState(500);

  const [site, setSite] = useState("");
  const [raw, setRaw] = useState<RawRanking[]>([]);
  const [pages, setPages] = useState<Record<string, PageInfo>>({});
  const [isSample, setIsSample] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [prog, setProg] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const rows = useMemo(() => buildRows(raw), [raw]);
  const [view, setView] = useState<ViewSpec>({});
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"table" | "topic">("table");

  const visible = useMemo(() => {
    const v = { ...view };
    if (search.trim()) v.keyword_contains = [...(v.keyword_contains ?? []), search.trim()];
    return applyView(rows, pages, v);
  }, [rows, pages, view, search]);

  const stats = useMemo(() => {
    const cann = rows.filter((r) => r.cannibalized);
    const urls = new Set<string>();
    cann.forEach((r) => [r.topUrl, ...r.competing.map((c) => c.url)].forEach((u) => urls.add(normUrl(u))));
    return {
      total: rows.length,
      cannibalized: cann.length,
      pct: rows.length ? Math.round((cann.length / rows.length) * 100) : 0,
      urls: urls.size,
      cannVolume: cann.reduce((s, r) => s + (r.volume ?? 0), 0),
    };
  }, [rows]);

  async function run() {
    if (!keys.mozToken) return setShowSettings(true);
    if (!query.trim()) return setError("Enter a domain or URL to analyze.");
    setError(null);
    setIsSample(false);
    setRaw([]);
    setPages({});
    setView({});
    cancelRef.current = false;
    const target = query.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    setSite(target);
    try {
      // 1) Ranking keywords (paged, 500 per call)
      const all: RawRanking[] = [];
      for (let page = 0; all.length < maxKw && !cancelRef.current; page++) {
        setPhase(`Pulling ranking keywords from Moz… ${all.length.toLocaleString()} so far`);
        setProg(Math.min(45, (all.length / maxKw) * 45));
        const limit = Math.min(500, maxKw - all.length);
        const res = await api<{ rows: RawRanking[]; done: boolean }>(
          "/api/keywords",
          { query: target, scope, locale, page, limit },
          keys
        );
        all.push(...res.rows);
        setRaw([...all]);
        if (res.done) break;
      }
      if (!all.length) {
        setPhase(null);
        return setError("Moz returned no ranking keywords for that target. Try a different scope or locale.");
      }
      // 2) Enrich top-ranking URLs with title, publish date, PA and inbound links
      const grouped = buildRows(all);
      const urls = [...new Map(grouped.map((r) => [normUrl(r.topUrl), r.topUrl])).values()];
      const batches: string[][] = [];
      for (let i = 0; i < urls.length; i += 8) batches.push(urls.slice(i, i + 8));
      let done = 0;
      const acc: Record<string, PageInfo> = {};
      const worker = async () => {
        while (batches.length && !cancelRef.current) {
          const b = batches.shift()!;
          try {
            const res = await api<{ pages: PageInfo[] }>("/api/enrich", { urls: b }, keys);
            res.pages.forEach((p) => (acc[normUrl(p.url)] = p));
          } catch (e) {
            b.forEach((u) => (acc[normUrl(u)] = { url: u, title: null, datePublished: null, pageAuthority: null, inboundLinks: null, linkingDomains: null, error: (e as Error).message }));
          }
          done += b.length;
          setPhase(`Fetching page titles, dates, PA and links… ${done}/${urls.length} URLs`);
          setProg(45 + (done / urls.length) * 55);
          setPages({ ...acc });
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      setPhase(null);
    } catch (e) {
      setPhase(null);
      setError((e as Error).message);
    }
  }

  function loadSample() {
    setError(null);
    setIsSample(true);
    setSite("example-seo.com");
    setQuery("example-seo.com");
    setRaw(sampleRaw);
    setPages(samplePages);
    setView({});
  }

  function exportCsv() {
    const csv = toCsv(visible, pages);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${site || "site"}-keyword-cannibalization${view.cannibalized ? "-cannibalized" : ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const sortBy = (f: NonNullable<ViewSpec["sort_field"]>) =>
    setView((v) => ({ ...v, sort_field: f, sort_dir: v.sort_field === f && v.sort_dir !== "asc" ? "asc" : "desc" }));

  const hasData = rows.length > 0;

  return (
    <>
      <div className="topbar">
        <div className="logo">K</div>
        <div>
          <h1>Keyword Cannibalization Checker</h1>
          <div className="sub">Moz API data · organised by Claude</div>
        </div>
        <div className="spacer" />
        <button className="btn ghost-dark small" onClick={() => setShowSettings(true)}>
          {keys.mozToken && keys.anthropicKey ? "API keys ✓" : "Add API keys"}
        </button>
      </div>

      <div className="wrap">
        <div className="card search">
          <div className="field">
            <label>Website</label>
            <input
              placeholder="e.g. moz.com"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
            />
          </div>
          <div className="field">
            <label>Scope</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="domain">Root domain</option>
              <option value="subdomain">Subdomain</option>
              <option value="subfolder">Subfolder</option>
              <option value="url">Exact URL</option>
            </select>
          </div>
          <div className="field">
            <label>Location</label>
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="en-US">United States</option>
              <option value="en-GB">United Kingdom</option>
              <option value="en-CA">Canada</option>
              <option value="en-AU">Australia</option>
            </select>
          </div>
          <div className="field">
            <label>Max keywords</label>
            <select value={maxKw} onChange={(e) => setMaxKw(Number(e.target.value))}>
              {[100, 500, 1000, 2000, 5000].map((n) => (
                <option key={n} value={n}>{n.toLocaleString()}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {phase ? (
              <button className="btn" onClick={() => (cancelRef.current = true)}>Stop</button>
            ) : (
              <button className="btn primary" onClick={run}>Analyze</button>
            )}
          </div>
        </div>

        {phase && (
          <div className="card progress">
            <span>{phase}</span>
            <div className="bar"><i style={{ width: `${prog}%` }} /></div>
          </div>
        )}
        {error && <div className="err">{error}</div>}
        {isSample && <div className="banner">You're viewing <b>sample data</b> for a made-up site so you can explore the tool. Add your keys and click Analyze to run it on a real site.</div>}

        {!hasData && !phase && (
          <div className="card empty" style={{ marginTop: 16 }}>
            <h2>Find the pages competing against each other</h2>
            <div>Enter a site, pick a location and click Analyze. Moz pulls every keyword the site ranks for; any keyword with two or more of your URLs ranking is flagged as cannibalized.</div>
            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={loadSample}>Try it with sample data</button>
            </div>
          </div>
        )}

        {hasData && (
          <>
            <div className="stats">
              <div className="card stat"><div className="k">Ranking keywords</div><div className="v">{stats.total.toLocaleString()}</div></div>
              <div className="card stat"><div className="k">Cannibalized keywords</div><div className="v red">{stats.cannibalized.toLocaleString()} <span style={{ fontSize: 14, color: "var(--muted)" }}>({stats.pct}%)</span></div></div>
              <div className="card stat"><div className="k">URLs involved</div><div className="v">{stats.urls.toLocaleString()}</div></div>
              <div className="card stat"><div className="k">Search volume at risk</div><div className="v">{stats.cannVolume.toLocaleString()}</div></div>
            </div>

            <div className="tabs">
              <button className={`tab ${tab === "table" ? "on" : ""}`} onClick={() => setTab("table")}>Keywords</button>
              <button className={`tab ${tab === "topic" ? "on" : ""}`} onClick={() => setTab("topic")}>New content checker</button>
            </div>

            {tab === "table" ? (
              <div className="main">
                <div className="card">
                  <div className="toolbar">
                    <div className="seg">
                      {([["All", null], ["Cannibalized", true], ["Clean", false]] as const).map(([label, val]) => (
                        <button key={label} className={(view.cannibalized ?? null) === val ? "on" : ""} onClick={() => setView((v) => ({ ...v, cannibalized: val }))}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <input placeholder="Search keywords…" value={search} onChange={(e) => setSearch(e.target.value)} />
                    <div className="chips">
                      {describeView({ ...view, cannibalized: undefined }).map((c) => <span className="chip" key={c}>{c}</span>)}
                      {Object.values(view).some((x) => x != null && !(Array.isArray(x) && !x.length)) && (
                        <button className="btn small" onClick={() => setView({})}>Reset</button>
                      )}
                    </div>
                    <span className="count">{visible.length.toLocaleString()} of {rows.length.toLocaleString()}</span>
                    <button className="btn small" onClick={exportCsv}>Export CSV</button>
                  </div>
                  <KeywordTable rows={visible} pages={pages} sortBy={sortBy} />
                </div>
                <ChatPanel keys={keys} rows={rows} pages={pages} site={site} stats={stats} view={view} setView={setView} needKeys={() => setShowSettings(true)} />
              </div>
            ) : (
              <TopicChecker keys={keys} rows={rows} pages={pages} site={site} needKeys={() => setShowSettings(true)} />
            )}
          </>
        )}
      </div>

      {showSettings && (
        <Settings
          keys={keys}
          onClose={() => setShowSettings(false)}
          onSave={(k) => {
            setKeys(k);
            try { localStorage.setItem(LS_KEYS, JSON.stringify(k)); } catch {}
            setShowSettings(false);
          }}
          onSample={() => { setShowSettings(false); loadSample(); }}
        />
      )}
    </>
  );
}

function KeywordTable({ rows, pages, sortBy }: { rows: KeywordRow[]; pages: Record<string, PageInfo>; sortBy: (f: NonNullable<ViewSpec["sort_field"]>) => void }) {
  const [limit, setLimit] = useState(200);
  useEffect(() => { setLimit(200); }, [rows]);
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th onClick={() => sortBy("keyword")}>Keyword</th>
            <th>Top ranking URL</th>
            <th>Page title</th>
            <th>Published</th>
            <th className="num" onClick={() => sortBy("volume")}>Volume ↕</th>
            <th className="num" onClick={() => sortBy("position")}>Position ↕</th>
            <th className="num">Inbound links</th>
            <th className="num" onClick={() => sortBy("pa")}>PA ↕</th>
            <th onClick={() => sortBy("competing")}>Cannibalized ↕</th>
            <th>Cannibalized URLs</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((r) => {
            const p = pages[normUrl(r.topUrl)];
            return (
              <tr className="row" key={r.keyword}>
                <td className="kw">{r.keyword}</td>
                <td className="url"><a href={fullUrl(r.topUrl)} target="_blank" rel="noreferrer" title={fullUrl(r.topUrl)}>{pathOf(r.topUrl)}</a></td>
                <td className="title">{p?.title ?? <span className="dim">{p ? "—" : "…"}</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>{p?.datePublished ?? <span className="dim">—</span>}</td>
                <td className="num">{fmt(r.volume)}</td>
                <td className="num">#{r.position ?? "?"}</td>
                <td className="num">{fmt(p?.inboundLinks)}</td>
                <td className="num">{fmt(p?.pageAuthority)}</td>
                <td><span className={`pill ${r.cannibalized ? "yes" : "no"}`}>{r.cannibalized ? `Yes · ${r.competing.length}` : "No"}</span></td>
                <td className="comp">
                  {r.competing.length ? (
                    <ul>
                      {r.competing.map((c) => (
                        <li key={c.url}><span className="pos">#{c.position ?? "?"}</span><a href={fullUrl(c.url)} target="_blank" rel="noreferrer" title={fullUrl(c.url)}>{pathOf(c.url)}</a></li>
                      ))}
                    </ul>
                  ) : <span className="dim">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > limit && (
        <div style={{ padding: 14, textAlign: "center" }}>
          <button className="btn small" onClick={() => setLimit((l) => l + 500)}>Show more ({(rows.length - limit).toLocaleString()} left)</button>
        </div>
      )}
      {!rows.length && <div className="empty">No keywords match this view.</div>}
    </div>
  );
}

function ChatPanel(props: {
  keys: Keys; rows: KeywordRow[]; pages: Record<string, PageInfo>; site: string;
  stats: Record<string, number>; view: ViewSpec; setView: (v: ViewSpec) => void; needKeys: () => void;
}) {
  const { keys, rows, site, stats, view, setView, needKeys } = props;
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Ask me to slice the table. Try “show only cannibalized keywords”, “cannibalized keywords over 1,000 searches”, or “blog pages fighting each other”." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    if (!keys.anthropicKey) return needKeys();
    const next = [...msgs, { role: "user" as const, content: text.trim() }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const folders = new Map<string, number>();
      rows.forEach((r) => {
        const m = r.topUrl.replace(/^https?:\/\/[^/]+/, "").replace(/^[^/]+/, "").match(/^\/[^/]+/);
        if (m) folders.set(m[0], (folders.get(m[0]) ?? 0) + 1);
      });
      const context = {
        site, ...stats,
        top_folders: [...folders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
        top_cannibalized: rows.filter((r) => r.cannibalized).slice(0, 15).map((r) => ({ k: r.keyword, v: r.volume, urls: 1 + r.competing.length })),
      };
      const convo = next.slice(1); // drop the canned greeting
      const res = await api<{ reply: string; view: ViewSpec }>("/api/chat", { messages: convo, context, currentView: view }, keys);
      setView(res.view);
      setMsgs([...next, { role: "assistant", content: res.reply }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card chat">
      <header><span className="logo" style={{ width: 22, height: 22, fontSize: 11, color: "#fff" }}>C</span> Ask Claude about this data</header>
      <div className="msgs" ref={box}>
        {msgs.map((m, i) => <div key={i} className={`msg ${m.role}`}>{m.content}</div>)}
        {busy && <div className="msg assistant dim">Thinking…</div>}
      </div>
      <div className="suggest">
        {["Only cannibalized keywords", "Cannibalized, volume over 500", "Worst offenders (most competing URLs)", "Reset to all keywords"].map((s) => (
          <button key={s} onClick={() => send(s)}>{s}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input placeholder="Ask or filter…" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn primary" disabled={busy}>Send</button>
      </form>
    </div>
  );
}

const VERDICT_LABEL = { create_new: "Create new content", refresh_existing: "Refresh existing page", merge: "Merge overlapping pages" };

function TopicChecker({ keys, rows, pages, site, needKeys }: { keys: Keys; rows: KeywordRow[]; pages: Record<string, PageInfo>; site: string; needKeys: () => void }) {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Decision | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function check() {
    if (!topic.trim()) return;
    if (!keys.anthropicKey) return needKeys();
    setBusy(true); setErr(null); setRes(null);
    try {
      const idx = pageIndex(rows, pages);
      setRes(await api<Decision>("/api/topic", { topic, site, pages: idx }, keys));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card topic">
      <h4>Planning new content?</h4>
      <div style={{ color: "var(--muted)", marginBottom: 12 }}>
        Enter the topic you want to write about. Claude checks every page {site || "the site"} already ranks with and tells you whether to create something new, refresh what you have, or merge pages that overlap.
      </div>
      <form className="topic-form" onSubmit={(e) => { e.preventDefault(); check(); }}>
        <input placeholder="e.g. how to check domain authority" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <button className="btn primary" disabled={busy}>{busy ? "Checking…" : "Check topic"}</button>
      </form>
      {err && <div className="err">{err}</div>}
      {res && (
        <>
          <div className={`verdict ${res.verdict}`}>
            <div className="tag">{VERDICT_LABEL[res.verdict] ?? res.verdict}</div>
            <h3>{res.headline}</h3>
            <div>{res.reasoning}</div>
            {res.primary_url && (
              <div style={{ marginTop: 10 }}>
                <b>{res.verdict === "merge" ? "Merge into: " : "Page to refresh: "}</b>
                <a href={fullUrl(res.primary_url)} target="_blank" rel="noreferrer">{shortUrl(res.primary_url)}</a>
              </div>
            )}
            {!!res.merge_urls?.length && (
              <div style={{ marginTop: 6 }}>
                <b>Fold in and 301: </b>
                {res.merge_urls.map((u, i) => (
                  <span key={u}>{i ? ", " : ""}<a href={fullUrl(u)} target="_blank" rel="noreferrer">{shortUrl(u)}</a></span>
                ))}
              </div>
            )}
          </div>
          <div className="cols">
            <div>
              <h4>Existing pages on this topic ({res.related_pages.length})</h4>
              {res.related_pages.length ? (
                <ul className="related" style={{ paddingLeft: 18 }}>
                  {res.related_pages.map((p) => (
                    <li key={p.url}>
                      <span className={`ov ${p.overlap}`}>{p.overlap}</span>
                      <a href={fullUrl(p.url)} target="_blank" rel="noreferrer">{p.title || shortUrl(p.url)}</a>
                      <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{p.why}</div>
                    </li>
                  ))}
                </ul>
              ) : <div className="dim">No existing pages found for this topic.</div>}
            </div>
            <div>
              <h4>Next steps</h4>
              <ol style={{ paddingLeft: 18, marginTop: 0 }}>{res.next_steps.map((s, i) => <li key={i} style={{ marginBottom: 6 }}>{s}</li>)}</ol>
              {!!res.target_keywords?.length && (
                <>
                  <h4 style={{ marginTop: 14 }}>Target keywords</h4>
                  <div className="chips">{res.target_keywords.map((k) => <span className="chip" key={k}>{k}</span>)}</div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Settings({ keys, onSave, onClose, onSample }: { keys: Keys; onSave: (k: Keys) => void; onClose: () => void; onSample: () => void }) {
  const [k, setK] = useState(keys);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()}>
        <h2>Connect your APIs</h2>
        <p>Your keys stay in this browser (local storage) and are only sent to this app's server to call Moz and Claude on your behalf. They are never stored on the server.</p>
        <div className="field">
          <label>Moz API token</label>
          <input type="password" value={k.mozToken} onChange={(e) => setK({ ...k, mozToken: e.target.value })} placeholder="From moz.com/api/dashboard" />
        </div>
        <div className="field">
          <label>Claude (Anthropic) API key</label>
          <input type="password" value={k.anthropicKey} onChange={(e) => setK({ ...k, anthropicKey: e.target.value })} placeholder="sk-ant-…  from console.anthropic.com" />
        </div>
        <div className="field">
          <label>Claude model</label>
          <input value={k.model} onChange={(e) => setK({ ...k, model: e.target.value })} />
        </div>
        <div className="row-end">
          <button className="btn" onClick={onSample}>Just show me sample data</button>
          <button className="btn primary" onClick={() => onSave({ ...k, mozToken: k.mozToken.trim(), anthropicKey: k.anthropicKey.trim(), model: k.model.trim() || DEFAULT_MODEL })}>Save</button>
        </div>
      </div>
    </div>
  );
}
