"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ImageValue } from "../../types";

const URL_RX = /^https?:\/\/[^\s]+/i;

export function LinkTab({ onSelect }: { onSelect: (c: ImageValue) => void }) {
  const request = React.useRef(0);
  React.useEffect(() => () => { request.current++; }, []);
  const [url, setUrl] = React.useState("");
  const [verifying, setVerifying] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async () => {
    if (verifying) return;
    const v = url.trim();
    if (!URL_RX.test(v)) { setErr("Paste a full https:// image URL"); return; }
    const current = ++request.current;
    setErr(null);
    setVerifying(true);
    const valid = await new Promise<boolean>((resolve) => {
      const img = new Image();
      const timer = window.setTimeout(() => finish(false), 10000);
      const finish = (ok: boolean) => {
        window.clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        resolve(ok);
      };
      img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0);
      img.onerror = () => finish(false);
      img.src = v;
    });
    if (current !== request.current) return;
    setVerifying(false);
    if (!valid) { setErr("Could not load this image. Check the URL and try again."); return; }
    onSelect({ type: "link", value: v, positionY: 50 });
  };

  return (
    <div className="space-y-3 p-4">
      <Input
        aria-label="Image URL"
        placeholder="https://images.example.com/photo.jpg"
        value={url}
        onChange={(e) => { request.current++; setVerifying(false); setUrl(e.target.value); }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
      <Button onClick={submit} disabled={verifying} className="w-full">
        {verifying ? "Checking…" : "Add image"}
      </Button>
      <p className="text-[11px] text-muted-foreground">Works with any public image URL.</p>
    </div>
  );
}
