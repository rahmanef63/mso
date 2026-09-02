"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Music, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppFrame, openWindow, saveAs, usePublishInspector } from "@/features/appshell";
import { rawUrl } from "../lib/host";
import { cn } from "@/lib/utils";
import { editorFor } from "../lib/media";
import { kindForName, isTextual, type ViewKind } from "../lib/kinds";
import { useSiblings } from "../lib/use-siblings";
import { TextView } from "./text-view";
import { FallbackCard } from "./fallback-card";

export type RemoteFile = { path: string; name: string; kind: ViewKind };

// Checkerboard stage so transparent/letterboxed media reads clearly.
const STAGE = "bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:24px_24px]";

// A real host file, streamed from /api/v1/fs/raw (the session cookie authenticates
// the <img>/<video>/<audio> src directly), with ← → through the rest of the folder.
export function RemoteView({ file }: { file: RemoteFile }) {
  // The window opens on one file and then pages; `current` is what is on screen.
  // Keyed by path so a NEW payload (a second Open from Files) wins over paging.
  const [paged, setPaged] = useState<RemoteFile | null>(null);
  const current = paged?.path && paged.path !== file.path ? paged : file;
  const { index, items, go } = useSiblings(current.path, current.name);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const failed = failedPath === current.path;

  const kind = current.kind;
  const src = rawUrl(current.path);
  const editor = editorFor(kind);
  const ext = current.name.includes(".") ? (current.name.split(".").pop() ?? "") : "";

  const step = useCallback(
    (delta: number) => {
      const next = go(delta);
      if (next) setPaged({ path: next.path, name: next.name, kind: next.kind });
    },
    [go],
  );

  // ← → anywhere in the window, the way Preview and Photos both behave. Bound on
  // the window's own document; typing in an input is not a case here (the viewer
  // has no text field), so no focus guard is needed beyond ignoring modifiers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const download = useCallback(() => saveAs(src, current.name), [src, current.name]);

  const openInEditor = useCallback(() => {
    if (!editor) return;
    openWindow(editor.app, current.name, undefined, { path: current.path, name: current.name, kind });
  }, [editor, current.path, current.name, kind]);

  usePublishInspector(
    "media-viewer",
    {
      subject: current.name,
      props: [
        { label: "Type", value: kind },
        { label: "Source", value: current.path },
        ...(items.length > 1 ? [{ label: "In folder", value: `${index + 1} of ${items.length}` }] : []),
      ],
      actions: [
        { id: "download", label: "Download", run: download },
        ...(editor ? [{ id: "edit", label: `Open in ${editor.label}`, run: openInEditor }] : []),
      ],
      context: `Viewing ${current.name} (${kind})`,
      suggestions: ["Describe this", "Suggest edits", "What format is best?"],
    },
    [current.path, current.name, kind, editor?.app, index, items.length],
  );

  const paging = items.length > 1;
  const fullBleed = kind === "pdf" || isTextual(kind);

  return (
    <AppFrame
      className="bg-background"
      header={
        // data-preview-file: which file is on screen, in one place on BOTH surfaces.
        // The desktop wraps this in window chrome and the mobile shell does not, so
        // an e2e that reads "the header" reads two different things; this reads one.
        <header data-preview-file={current.name} className="flex items-center gap-2 bg-background/60 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{current.name}</span>
          {paging && (
            <span className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground sm:inline">
              {index + 1} / {items.length}
            </span>
          )}
          <Badge variant="secondary" className="shrink-0 font-mono text-[10px] uppercase">
            {kind === "none" ? (ext || "file") : kind}
          </Badge>
          <Button size="sm" variant="ghost" onClick={download} aria-label="Download">
            <Download className="size-3.5" />
          </Button>
          {editor && (
            <Button size="sm" variant="ghost" onClick={openInEditor} aria-label={`Open in ${editor.label}`}>
              <Pencil className="size-3.5" />
            </Button>
          )}
        </header>
      }
      bodyClassName="flex flex-col"
    >
      <div className="relative flex min-h-0 flex-1">
        <div
          className={cn(
            "flex min-h-0 w-full flex-1",
            fullBleed && !failed ? "" : cn("items-center justify-center overflow-hidden p-3", STAGE),
          )}
        >
          {failed || kind === "none" ? (
            <FallbackCard
              name={current.name}
              ext={ext}
              reason={failed ? "This browser could not decode the file." : "No browser can render this format."}
              onDownload={download}
              editorLabel={failed ? editor?.label : undefined}
              onOpenEditor={openInEditor}
            />
          ) : kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={current.path}
              src={src}
              alt={current.name}
              onError={() => setFailedPath(current.path)}
              className="h-full w-full object-contain"
            />
          ) : kind === "video" ? (
            <video
              key={current.path}
              src={src}
              controls
              playsInline
              onError={() => setFailedPath(current.path)}
              className="h-full w-full object-contain"
            />
          ) : kind === "audio" ? (
            <div className="flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl border bg-card/80 p-6 shadow-2xl backdrop-blur">
              <div className="grid size-14 place-items-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
                <Music className="size-7" />
              </div>
              <div className="w-full truncate text-center text-sm font-semibold">{current.name}</div>
              <audio key={current.path} src={src} controls onError={() => setFailedPath(current.path)} className="w-full" />
            </div>
          ) : isTextual(kind) ? (
            <TextView key={current.path} path={current.path} name={current.name} kind={kind} />
          ) : (
            <iframe key={current.path} src={src} title={current.name} className="h-full w-full border-0 bg-white" />
          )}
        </div>

        {/* Overlaid, not in the toolbar: the arrows belong next to what they page.
            44px targets on touch, and they sit above a PDF/HTML frame that swallows
            its own clicks. */}
        {paging && (
          <>
            <PageButton side="left" onClick={() => step(-1)} />
            <PageButton side="right" onClick={() => step(1)} />
          </>
        )}
      </div>
    </AppFrame>
  );
}

function PageButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous file" : "Next file"}
      className={cn(
        "absolute top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full border bg-background/80 text-foreground shadow-lg backdrop-blur transition-opacity hover:bg-background",
        "[@media(pointer:coarse)]:size-11",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

/** Extract a `{ path, name, kind }` remote-file from the window payload. The kind
 *  is derived from the NAME, not trusted from the payload: callers disagreed about
 *  it (Files sent its own four-value enum), and the file's extension is the fact. */
export function remoteFile(payload: unknown): RemoteFile | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { path?: unknown; name?: unknown };
  if (typeof p.path !== "string" || !p.path) return null;
  const name = typeof p.name === "string" && p.name ? p.name : (p.path.split("/").pop() ?? p.path);
  return { path: p.path, name, kind: kindForName(name) };
}
