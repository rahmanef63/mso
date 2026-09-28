"use client";
import { useId, useState } from "react";
import { FormDrawer } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CONNECTED_APP_MANIFEST_MAX_BYTES, parseConnectedAppManifest, type ConnectedAppManifest } from "@/lib/contracts/connected-app-manifest";
import { ConnectAppForm } from "./connect-app-form";

export function ImportAppManifest({ onClose }: { onClose: () => void }) {
  const prefix = useId();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [manifest, setManifest] = useState<ConnectedAppManifest | null>(null);
  const readFile = async (file?: File) => {
    if (!file) return;
    setRaw(""); setError(""); setReading(true);
    try {
      if (file.size > CONNECTED_APP_MANIFEST_MAX_BYTES) throw new Error("Manifest exceeds the 8 KiB limit.");
      setRaw(await file.text());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read this file."); }
    finally { setReading(false); }
  };
  if (manifest) return <ConnectAppForm manifest={manifest} onClose={onClose}/>;
  return <FormDrawer open onOpenChange={open => { if (!open && !reading) onClose(); }} size="md">
    <FormDrawer.Header><FormDrawer.Title>Import app manifest</FormDrawer.Title><FormDrawer.Description>Choose a connected app JSON file from its developer, or paste it below. You will review the app and enter your instance address next.</FormDrawer.Description></FormDrawer.Header>
    <div className="min-h-0 space-y-4 overflow-y-auto px-4 pb-4">
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-file`}>Manifest file</Label><Input id={`${prefix}-file`} type="file" accept=".json,application/json" disabled={reading} onChange={event => void readFile(event.target.files?.[0])}/></div>
      <div className="space-y-1.5"><Label htmlFor={`${prefix}-json`}>Manifest JSON</Label><Textarea id={`${prefix}-json`} value={raw} disabled={reading} maxLength={CONNECTED_APP_MANIFEST_MAX_BYTES} rows={8} onChange={event => { setRaw(event.target.value); setError(""); }}/></div>
      <p className="text-xs text-muted-foreground">Publisher names are self-declared. Importing connects a running application; it does not install code or grant access to MSO tools or credentials.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={reading} onClick={onClose}>Cancel</Button><Button disabled={reading || !raw.trim()} onClick={() => {
        try { setManifest(parseConnectedAppManifest(raw)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Invalid manifest."); }
      }}>Review app</Button></div>
    </div>
  </FormDrawer>;
}
