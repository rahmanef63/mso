"use client";

import { useEffect, useState } from "react";
import { Code2, FileText, Globe, Moon, Palette, Sun, Timer as TimerIcon } from "lucide-react";
import { setShell, shellsForSurface, useActiveShell, useShellPrefs } from "../../../registry/shells";
import { useShellAppearance } from "../../../registry/capabilities";
import { cn } from "@/lib/utils";
import { Card } from "./widget-cards";
import { mdToHtml } from "./md";
import { safeEmbedUrl } from "./embed-url";

// VPS-native + content widgets ported from shell.rahmanef.com's set: a stopwatch,
// a URL embed, a sandboxed-HTML snippet, a markdown note, an active-shell picker,
// and a theme toggle. Split out to keep widgets-defs.tsx under the line ceiling.
// All are interactive (opt back into pointer events).

const EMBED_KEY = "mso:widget:embed";
const HTML_KEY = "mso:widget:html";
const MD_KEY = "mso:widget:markdown";
const ls = (k: string) => (typeof localStorage !== "undefined" ? localStorage.getItem(k) ?? "" : "");
const btn = "rounded-lg border border-white/10 bg-black/10 px-2 py-1 text-xs hover:bg-white/10";

// Stopwatch — start/pause/reset. The interval only ticks while running.
function TimerWidget() {
  const [ms, setMs] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setMs((m) => m + 100), 100);
    return () => clearInterval(t);
  }, [running]);
  const s = Math.floor(ms / 1000);
  const label = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <Card className="pointer-events-auto">
      <div className="mb-2 flex items-center gap-2">
        <TimerIcon className="size-4 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">Timer</span>
        <span className="ml-auto font-mono text-lg font-bold tabular-nums">{label}</span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setRunning((r) => !r)} className={cn(btn, "flex-1")}>
          {running ? "Pause" : "Start"}
        </button>
        <button type="button" onClick={() => { setRunning(false); setMs(0); }} className={cn(btn, "flex-1")}>
          Reset
        </button>
      </div>
    </Card>
  );
}

// Embeds a URL in an iframe (frameable content only — CSP + the target's
// X-Frame-Options still apply). URL persists to localStorage.
function EmbedWidget() {
  const initial = typeof window === "undefined" ? "" : safeEmbedUrl(ls(EMBED_KEY), window.location.origin) ?? "";
  const [url, setUrl] = useState(initial);
  const [draft, setDraft] = useState(url);
  const [error, setError] = useState("");
  const save = (v: string) => {
    if (!v) {
      setUrl("");
      setError("");
      try { localStorage.removeItem(EMBED_KEY); } catch { /* quota */ }
      return;
    }
    const safe = safeEmbedUrl(v, window.location.origin);
    if (!safe) {
      setError("Use an external HTTPS URL without credentials.");
      return;
    }
    setUrl(safe);
    setDraft(safe);
    setError("");
    try { localStorage.setItem(EMBED_KEY, safe); } catch { /* quota */ }
  };
  return (
    <Card className="pointer-events-auto">
      <div className="mb-2 flex items-center gap-2">
        <Globe className="size-4 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">Embed</span>
        {url && (
          <button type="button" onClick={() => { save(""); setDraft(""); }} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">
            change
          </button>
        )}
      </div>
      {url ? (
        <iframe src={url} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" title="External embed" className="h-40 w-full rounded-lg border border-white/10 bg-white" />
      ) : (
        <div className="flex gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && draft.trim() && save(draft.trim())}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/10 px-2 py-1 text-xs outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={() => draft.trim() && save(draft.trim())} className={btn}>Go</button>
        </div>
      )}
      {error && <p className="mt-1 text-[10px] text-destructive">{error}</p>}
    </Card>
  );
}

// A raw-HTML snippet rendered in a SANDBOXED iframe (allow-scripts only — no
// same-origin, so it can't touch the cockpit), same guard as HTML wallpapers.
function HtmlWidget() {
  const [html, setHtml] = useState(() => ls(HTML_KEY));
  const [editing, setEditing] = useState(!html);
  const save = () => { try { localStorage.setItem(HTML_KEY, html); } catch { /* quota */ } setEditing(false); };
  return (
    <Card className="pointer-events-auto">
      <div className="mb-2 flex items-center gap-2">
        <Code2 className="size-4 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">HTML</span>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">edit</button>
        )}
      </div>
      {editing ? (
        <div className="space-y-1">
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            placeholder="<b>Hello</b>"
            className="h-24 w-full resize-none rounded-lg border border-white/10 bg-black/10 p-2 font-mono text-[11px] outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={save} className={cn(btn, "w-full")}>Save</button>
        </div>
      ) : (
        <iframe sandbox="allow-scripts" srcDoc={html} title="HTML" className="h-32 w-full rounded-lg border border-white/10 bg-white" />
      )}
    </Card>
  );
}

// Switches the active shell for the CURRENT surface. On a phone this intentionally
// offers iOS/Android; desktop widgets offer macOS/Windows/Dashboard.
function ShellWidget() {
  const prefs = useShellPrefs();
  const { surface } = useActiveShell();
  const shells = shellsForSurface(surface);
  const active = prefs[surface];
  return (
    <Card className="pointer-events-auto">
      <div className="mb-2 flex items-center gap-2">
        <Palette className="size-4 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">Shell</span>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {shells.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setShell(surface, s.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
              active === s.id ? "bg-primary text-primary-foreground" : "hover:bg-white/10",
            )}
          >
            <s.icon className="size-4 shrink-0" />
            {s.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

// Light/dark theme toggle (VPS-native control) via the appearance capability.
function ThemeWidget() {
  const { theme, setTheme } = useShellAppearance();
  return (
    <Card className="pointer-events-auto">
      <div className="mb-2 flex items-center gap-2">
        <Palette className="size-4 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">Theme</span>
      </div>
      <div className="flex gap-1.5">
        {(["light", "dark"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(t)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs capitalize",
              theme === t ? "bg-primary text-primary-foreground" : "hover:bg-white/10",
            )}
          >
            {t === "light" ? <Sun className="size-4" /> : <Moon className="size-4" />} {t}
          </button>
        ))}
      </div>
    </Card>
  );
}

// A markdown note — edit raw markdown, view rendered. Persisted. Uses the safe
// mdToHtml above (escaped, http-only links).
function MarkdownWidget() {
  const [md, setMd] = useState(() => ls(MD_KEY));
  const [editing, setEditing] = useState(!md);
  const save = () => {
    try { localStorage.setItem(MD_KEY, md); } catch { /* quota */ }
    setEditing(false);
  };
  return (
    <Card className="pointer-events-auto">
      <div className="mb-2 flex items-center gap-2">
        <FileText className="size-4 text-muted-foreground" />
        <span className="text-[12.5px] font-semibold">Markdown</span>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">edit</button>
        )}
      </div>
      {editing ? (
        <div className="space-y-1">
          <textarea
            value={md}
            onChange={(e) => setMd(e.target.value)}
            placeholder={"# Title\n**bold**, *italic*, `code`\n- a bullet\n[link](https://…)"}
            className="h-28 w-full resize-none rounded-lg border border-white/10 bg-black/10 p-2 font-mono text-[11px] outline-none placeholder:text-muted-foreground"
          />
          <button type="button" onClick={save} className={cn(btn, "w-full")}>Save</button>
        </div>
      ) : (
        <div
          className="max-h-40 overflow-auto text-xs leading-relaxed [&_a]:text-primary"
          dangerouslySetInnerHTML={{ __html: mdToHtml(md) }}
        />
      )}
    </Card>
  );
}

export const VPS_WIDGETS = {
  timer: TimerWidget,
  embed: EmbedWidget,
  html: HtmlWidget,
  markdown: MarkdownWidget,
  shell: ShellWidget,
  theme: ThemeWidget,
};
