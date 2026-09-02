"use client";

import { Boxes, ExternalLink } from "lucide-react";
import type { AppProps } from "../lib/host";
import { AppConsole } from "./app-console";
import type { AppManifest } from "./runtime-app-types";

export type { AppManifest } from "./runtime-app-types";

const isUrl = (s: string) => /^https?:\/\//i.test(s);

// Generic host for runtime apps. HTML apps whose entry is a URL render in a
// sandboxed iframe; non-html apps whose entry is a command/script run live on
// the VPS via the OsApi exec contract (terminal-style console). Anything else
// falls back to the manifest card.
export function RuntimeApp({ manifest, payload }: { manifest?: AppManifest } & AppProps) {
  const m = manifest ?? (payload as AppManifest | undefined);

  if (!m) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        No app manifest.
      </div>
    );
  }

  if (m.runtime === "html" && isUrl(m.entry)) {
    return (
      <iframe
        title={m.title}
        src={m.entry}
        className="size-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    );
  }

  // Non-html runtime with a command/script entry → run it on the host.
  if (m.runtime !== "html" && m.entry && !isUrl(m.entry)) {
    return <AppConsole m={m} />;
  }

  return (
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card/60 p-6 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-secondary text-muted-foreground">
          <Boxes className="size-6" />
        </span>
        <div>
          <h2 className="text-base font-bold">{m.title}</h2>
          <p className="text-xs text-muted-foreground">
            {m.source === "store" ? "Installed app" : "Custom app"} · {m.runtime}
          </p>
        </div>
        <dl className="space-y-1 rounded-lg bg-secondary/50 p-3 text-left text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">runtime</dt>
            <dd className="font-mono">{m.runtime}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">entry</dt>
            <dd className="truncate font-mono">{m.entry || "—"}</dd>
          </div>
        </dl>
        {isUrl(m.entry) && (
          <a
            href={m.entry}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
          >
            <ExternalLink className="size-3.5" /> Open entry
          </a>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {m.runtime === "html"
            ? "Set a full https:// entry URL to embed this app."
            : "Set a command or script entry to run this app on the VPS."}
        </p>
      </div>
    </div>
  );
}
