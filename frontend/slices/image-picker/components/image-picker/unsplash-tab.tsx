"use client";

/** Stock tab — debounced live search against /api/v1/stock/search (keyless
 *  Openverse by default, Unsplash when the server has OS_UNSPLASH_ACCESS_KEY).
 *  Shows the bundled curated set until a query is typed; picking delivers the
 *  full-size URL as an ImageValue, same contract as the Link/Upload tabs. */

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CURATED_UNSPLASH } from "../../lib/unsplashCurated";
import type { ImageValue } from "../../types";

/** Slim result shape returned by /api/v1/stock/search. */
interface StockResult { id: string; thumb: string; url: string; title: string; creator: string; license: string }

const CURATED: StockResult[] = CURATED_UNSPLASH.map((p) => ({
  id: p.id, thumb: p.thumb, url: p.regular, title: p.alt, creator: p.photographer, license: "Unsplash",
}));

export function UnsplashTab({ onSelect, defaultQuery }: { onSelect: (c: ImageValue) => void; defaultQuery?: string }) {
  const [q, setQ] = React.useState(defaultQuery ?? "");
  const [results, setResults] = React.useState<StockResult[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Debounced search; aborts in-flight + stale-timer on every keystroke.
  React.useEffect(() => {
    const query = q.trim();
    const ctl = new AbortController();
    const id = window.setTimeout(async () => {
      if (!query) { setResults(null); setErr(null); setBusy(false); return; }
      setBusy(true);
      setErr(null);
      try {
        const res = await fetch(`/api/v1/stock/search?q=${encodeURIComponent(query)}`, { signal: ctl.signal });
        if (!res.ok)
          throw new Error(res.status === 401 ? "Sign in to search stock photos" : "Search failed. Try again");
        const data = (await res.json()) as { results?: StockResult[] };
        if (!ctl.signal.aborted) setResults(data.results ?? []);
      } catch (e) {
        if (!ctl.signal.aborted) { setErr((e as Error).message); setResults(null); }
      } finally {
        if (!ctl.signal.aborted) setBusy(false);
      }
    }, query ? 400 : 0);
    return () => { window.clearTimeout(id); ctl.abort(); };
  }, [q]);

  const photos = results ?? CURATED;
  const pick = (r: StockResult) =>
    onSelect({
      type: "unsplash", value: r.url, positionY: 50,
      metadata: { id: r.id, thumb: r.thumb, title: r.title, creator: r.creator, license: r.license },
    });

  return (
    <div className="@container space-y-3 p-4">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="px-8" placeholder="Search stock photos…" aria-label="Search stock photos"
          value={q} onChange={(e) => setQ(e.target.value)}
        />
        {busy && (
          <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      {!results && !err && (
        <p className="text-[11px] text-muted-foreground">Curated landscapes. Type above for live search.</p>
      )}
      {results?.length === 0 && !busy && (
        <p className="text-xs text-muted-foreground">No results for &ldquo;{q.trim()}&rdquo;.</p>
      )}
      <div className="grid grid-cols-2 gap-2 @md:grid-cols-3 @2xl:grid-cols-4">
        {photos.map((r) => (
          <button
            key={r.id} type="button" onClick={() => pick(r)}
            className="group relative h-20 overflow-hidden rounded-md ring-1 ring-border transition hover:ring-2 hover:ring-primary"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.thumb} alt={r.title || "Stock photo"} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-left text-[9px] text-white">
              {r.creator || "Unknown"} · {r.license}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
