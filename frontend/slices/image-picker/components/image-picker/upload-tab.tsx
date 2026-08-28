"use client";

import * as React from "react";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImageValue, UploadFn } from "../../types";

const MAX = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);

export function UploadTab({ onSelect, onUpload }: { onSelect: (c: ImageValue) => void; onUpload: UploadFn }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!ALLOWED_IMAGE_TYPES.has(f.type)) { setErr("PNG, JPEG, WebP, GIF or AVIF only"); return; }
    if (f.size > MAX) { setErr("Max 8 MB"); return; }
    setErr(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const apply = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const ref = await onUpload(file);
      onSelect({ type: "upload", value: ref, positionY: 50, metadata: { filename: file.name } });
    } catch (e) {
      setErr(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 p-4">
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
        className="flex h-32 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-md border-2 border-dashed border-border text-sm text-muted-foreground transition hover:border-primary"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <>
            <UploadCloud className="h-6 w-6" />
            <span>Drag an image or click to choose (≤ 8 MB)</span>
          </>
        )}
        <input type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? undefined)} />
      </label>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <Button onClick={apply} disabled={!file || busy} className="w-full">
        {busy ? "Uploading…" : "Upload & set image"}
      </Button>
    </div>
  );
}
