"use client";

import { useEffect, useRef, useState } from "react";
import type { Composition, MediaType } from "../lib/mock-timeline";
import { probeMedia } from "../lib/media-cache";
import { acceptsRelinkType, replaceMedia } from "../lib/relink-media";

export function AssetRecovery({ comp, apply }: {
  comp: Composition;
  apply: (fn: (c: Composition) => Composition, commit?: boolean) => void;
}) {
  // Blob URLs restored from a previous page cannot be decoded in this page.
  const [missing, setMissing] = useState(() => new Set(comp.clips.flatMap((c) =>
    c.media?.url.startsWith("blob:") ? [c.media.url] : [])));
  const [error, setError] = useState<string | null>(null);
  const owned = useRef<string[]>([]);
  const alive = useRef(true);
  useEffect(() => { const urls = owned.current; alive.current = true; return () => { alive.current = false; urls.forEach((url) => URL.revokeObjectURL(url)); }; }, []);
  const assets = Array.from(new Map(comp.clips.flatMap((c) =>
    c.media?.url.startsWith("blob:") ? [[c.media.url, { url: c.media.url, name: c.name, type: c.media.type }] as const] : [])).values());

  async function relink(oldUrl: string, type: MediaType, file: File) {
    if (!acceptsRelinkType(type, file.type)) {
      setError("Choose a file of the same media type.");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const metadata = await probeMedia(url, type);
      if (!alive.current) { URL.revokeObjectURL(url); return; }
      owned.current.push(url);
      apply((current) => replaceMedia(current, oldUrl, { url, type, ...metadata }), true);
      setMissing((current) => { const next = new Set(current); next.delete(oldUrl); return next; });
      setError(null);
    } catch {
      URL.revokeObjectURL(url);
      if (alive.current) setError("Could not read that file. Choose a compatible original and try again.");
    }
  }

  if (!assets.length) return null;
  return (
    <section aria-label="Uploaded media recovery" className="max-h-40 shrink-0 overflow-y-auto border-b bg-warning/15 px-3 py-2 text-sm">
      <p>Uploaded media is available only in this session. Keep the original files and relink them after reopening.</p>
      {assets.map((asset) => (
        <div key={asset.url} className="flex flex-wrap items-center gap-2">
          <span>{asset.name}: {missing.has(asset.url) ? "Needs relinking" : "Session only"}</span>
          <label className="flex flex-wrap items-center gap-2">
            Relink {asset.name}
            <input className="max-w-full rounded border text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" type="file" accept={asset.type + "/*"} onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void relink(asset.url, asset.type, file);
              e.currentTarget.value = "";
            }} />
          </label>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
