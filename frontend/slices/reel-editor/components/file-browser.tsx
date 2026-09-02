"use client";

import { useCallback, useEffect, useState } from "react";
import { Folder, FileVideo, FileAudio, FileImage, CornerLeftUp, Loader2 } from "lucide-react";
import { FormDrawer } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOsApi, type FsEntry, type FsList } from "../lib/host";
import type { MediaType } from "../lib/mock-timeline";

const IMG = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif"];
const VID = ["mp4", "webm", "mov", "mkv", "avi", "m4v", "ogv"];
const AUD = ["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"];

/** Classify a fs entry as importable media (by mime, then extension). */
export function mediaTypeOf(e: FsEntry): MediaType | null {
  const m = e.mime ?? "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  const ext = (e.ext ?? e.name.split(".").pop() ?? "").toLowerCase();
  if (IMG.includes(ext)) return "image";
  if (VID.includes(ext)) return "video";
  if (AUD.includes(ext)) return "audio";
  return null;
}

const join = (dir: string, name: string) => (dir.endsWith("/") ? dir + name : `${dir}/${name}`);
const ICON = { image: FileImage, video: FileVideo, audio: FileAudio };

// Browse the host filesystem and pick a media file to drop on the timeline.
// Live = the real VPS (fs.list → /api/v1, bytes via the cookie-authed raw route);
// demo = the mock fs (the "Media" root lists the real /demo-media assets).
export function FileBrowser({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (path: string, name: string, type: MediaType) => void;
}) {
  const api = useOsApi();
  const [data, setData] = useState<FsList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      setError(null);
      try {
        setData(await api.fs.list(p));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Cannot read folder");
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  // Initial listing on open, in .then form — `load` does a synchronous
  // setLoading(true) which react-hooks/set-state-in-effect forbids from an
  // effect body (it stays as-is for event handlers).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.fs
      .list("~")
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Cannot read folder"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, api]);

  const path = data?.path ?? "~";
  const entries = (data?.entries ?? [])
    .filter((e) => e.kind === "dir" || mediaTypeOf(e))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));

  return (
    <FormDrawer open={open} onOpenChange={onOpenChange} size="md">
      <FormDrawer.Header>
        <FormDrawer.Title>Import from VPS</FormDrawer.Title>
      </FormDrawer.Header>

      <FormDrawer.Body className="flex flex-col gap-3">
        {!!data?.roots?.length && (
          <div className="flex flex-wrap gap-1">
            {data.roots.map((r) => (
              <Button
                key={r.path}
                type="button"
                variant="ghost"
                onClick={() => void load(r.path)}
                className="h-6 rounded-md bg-secondary px-2 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground [@media(pointer:coarse)]:min-h-[44px]"
              >
                {r.label}
              </Button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={!data?.parent}
            onClick={() => data?.parent && void load(data.parent)}
            className="grid size-7 place-items-center rounded-md bg-secondary p-0 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 [@media(pointer:coarse)]:size-[44px]"
            aria-label="Up"
          >
            <CornerLeftUp className="size-4" />
          </Button>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={path}>
            {path}
          </span>
        </div>

        <div className="h-72 overflow-y-auto rounded-md border border-border">
          {loading ? (
            <div className="grid h-full place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : error ? (
            <div className="grid h-full place-items-center px-6 text-center text-xs text-destructive">{error}</div>
          ) : entries.length === 0 ? (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">No media in this folder</div>
          ) : (
            entries.map((e) => {
              const mt = e.kind === "file" ? mediaTypeOf(e) : null;
              const Icon = mt ? ICON[mt] : Folder;
              return (
                <Button
                  key={e.name}
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const full = join(path, e.name);
                    if (e.kind === "dir") void load(full);
                    else if (mt) {
                      onPick(full, e.name, mt);
                      onOpenChange(false);
                    }
                  }}
                  className="flex h-auto w-full items-center justify-start gap-2 rounded-none px-3 py-1.5 text-left text-sm font-normal hover:bg-accent [@media(pointer:coarse)]:min-h-[44px]"
                >
                  <Icon className={cn("size-4 shrink-0", e.kind === "dir" ? "text-primary" : "text-muted-foreground")} />
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  {mt && <span className="text-[10px] uppercase text-muted-foreground">{mt}</span>}
                </Button>
              );
            })
          )}
        </div>
      </FormDrawer.Body>
    </FormDrawer>
  );
}
