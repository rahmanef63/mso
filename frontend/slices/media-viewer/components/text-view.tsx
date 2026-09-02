"use client";

import { useEffect, useState } from "react";
import { Code2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mdToHtml } from "@/features/appshell";
import { rawUrl } from "../lib/host";
import type { ViewKind } from "../lib/kinds";

// Everything the browser cannot render by pointing an element at a URL: text,
// Markdown, CSV/TSV and HTML. The bytes are FETCHED and rendered here.
//
// For HTML that is a security decision, not a convenience: framing
// /api/v1/fs/raw would make an arbitrary host file an active document on the
// cockpit's own origin, with the session cookie attached. Instead the source goes
// into a fully sandboxed `srcdoc` iframe (no allow-scripts, no allow-same-origin),
// so it renders as layout and nothing more. Relative images inside it will not
// load — that is the price of not handing a file the origin.

/** One screenful and then some. Enough to read; small enough that a 2 GB log
 *  cannot be pulled into the tab by a double-click. Served by a Range request,
 *  which /api/v1/fs/raw already supports for video seeking. */
const MAX_BYTES = 512 * 1024;
const MAX_ROWS = 500;

interface Loaded {
  path: string;
  text: string | null;
  truncated: boolean;
  error: string | null;
}

function useFileText(path: string): Omit<Loaded, "path"> {
  // The load carries WHICH path it is for, so paging to the next file derives back
  // to "loading" instead of resetting state from inside an effect
  // (react-hooks/set-state-in-effect) — the same shape remote-view uses for errors.
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let alive = true;
    // Range, not a whole-file read: /api/v1/fs/raw already serves 206 for video
    // seeking, and a 2 GB log must not become a 2 GB string in the tab.
    fetch(rawUrl(path), { headers: { Range: `bytes=0-${MAX_BYTES - 1}` }, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        if (alive) setLoaded({ path, text: body, truncated: body.length >= MAX_BYTES - 1, error: null });
      })
      .catch(() => alive && setLoaded({ path, text: null, truncated: false, error: "Could not read this file." }));
    return () => {
      alive = false;
    };
  }, [path]);

  return loaded?.path === path ? loaded : { text: null, truncated: false, error: null };
}

/** Split on commas/tabs, honouring "quoted, fields" — the one CSV rule that
 *  actually bites. Anything fancier belongs in a spreadsheet, not a preview. */
function parseRows(text: string, sep: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(0, MAX_ROWS)
    .map((line) => {
      const cells: string[] = [];
      let cell = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (quoted && line[i + 1] === '"') {
            cell += '"';
            i++;
          } else quoted = !quoted;
        } else if (ch === sep && !quoted) {
          cells.push(cell);
          cell = "";
        } else cell += ch;
      }
      cells.push(cell);
      return cells;
    });
}

export function TextView({ path, name, kind }: { path: string; name: string; kind: ViewKind }) {
  const { text, truncated, error } = useFileText(path);
  const [source, setSource] = useState(false);

  if (error) return <p className="p-4 text-sm text-muted-foreground">{error}</p>;
  if (text === null) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  const rendered = kind === "html" && !source ? "html" : kind === "markdown" && !source ? "markdown" : kind === "csv" ? "csv" : "plain";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {(kind === "html" || kind === "markdown") && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSource((s) => !s)}>
            {source ? <Eye className="size-3.5" /> : <Code2 className="size-3.5" />}
            {source ? "Rendered" : "Source"}
          </Button>
          {kind === "html" && !source && (
            <span className="truncate text-[11px] text-muted-foreground">Sandboxed — scripts and relative assets are off</span>
          )}
        </div>
      )}

      {rendered === "html" ? (
        <iframe
          // sandbox="" is the strictest value: no scripts, no forms, opaque origin.
          sandbox=""
          srcDoc={text}
          title={name}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : rendered === "markdown" ? (
        <div
          className="min-h-0 flex-1 overflow-auto p-4 text-sm leading-relaxed [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:font-mono [&_h1]:pb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:pt-3 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold"
          dangerouslySetInnerHTML={{ __html: mdToHtml(text) }}
        />
      ) : rendered === "csv" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-max min-w-full border-collapse text-xs">
            <tbody>
              {parseRows(text, name.toLowerCase().endsWith(".tsv") ? "\t" : ",").map((row, r) => (
                <tr key={r} className={r === 0 ? "sticky top-0 bg-card font-semibold" : "odd:bg-muted/30"}>
                  {row.map((cell, c) => (
                    <td key={c} className="max-w-[28ch] truncate border-b border-r px-2 py-1" title={cell}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
          {text}
        </pre>
      )}

      {truncated && (
        <p className="shrink-0 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing the first {Math.round(MAX_BYTES / 1024)} KB — open it in the Code Editor for the whole file.
        </p>
      )}
    </div>
  );
}
