"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Download, DatabaseBackup, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { collectLocalState, FormDrawer, localStateFilename, parseLocalState, restoreLocalState, saveAs, type LocalStateBlob } from "@/features/appshell";
import { SettingsSection, SettingsActionRow, SettingsBlock } from "@/features/shell-settings";
import pkg from "../../../../package.json";

type Pending = { file: string; blob: LocalStateBlob; known: string[]; unknown: string[] };

// Backup for the state that exists in exactly ONE place — this browser's
// localStorage. Playbooks, Agents, Automations, the window layout, the app
// registry and the desktop-icon arrangement have no server copy, so a profile
// wipe is permanent. Export writes them to a .json; Import replaces them.
export function BackupSection() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [exported, setExported] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const doExport = () => {
    setError(null);
    const blob = collectLocalState(pkg.version ?? "0.0.0");
    const url = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" }));
    // saveAs owns the anchor rules AND the deferred revoke — this copy clicked a
    // DETACHED anchor, which Firefox ignores, so the backup silently did nothing there.
    saveAs(url, localStateFilename());
    setExported(Object.keys(blob.keys).length);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input NOW: picking the same file twice fires no change event
    // otherwise, so a user who fixes nothing and retries gets a dead button.
    e.target.value = "";
    if (!file) return;
    setError(null);
    setExported(null);
    const res = parseLocalState(await file.text());
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPending({ file: file.name, blob: res.blob, known: res.known, unknown: res.unknown });
  };

  const confirmImport = () => {
    if (!pending) return;
    restoreLocalState(pending.blob);
    setPending(null);
    // Full reload, not a state refresh: the layout store, app registry and
    // assistant store all read localStorage once at module init, so anything
    // short of a reload leaves half the cockpit on the pre-import data.
    window.location.reload();
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <SettingsSection
        icon={<DatabaseBackup />}
        title="Backup"
        footnote="Covers Playbooks, Agents, Automations, the window layout, installed apps, desktop icons, widgets and wallpapers — everything stored in this browser only. The approved-device identity is deliberately left out, so a leaked backup can't skip device approval. Appearance and Quicklinks also sync to the server, and the server copy wins on the next sign-in."
      >
        <SettingsActionRow label="Export backup…" icon={<Download />} onClick={doExport} />
        <SettingsActionRow label="Import backup…" icon={<Upload />} onClick={() => fileInput.current?.click()} />
        {exported !== null && (
          <SettingsBlock>
            <p className="text-xs text-muted-foreground">
              Saved {exported} {exported === 1 ? "entry" : "entries"} to your Downloads folder.
            </p>
          </SettingsBlock>
        )}
        {error && (
          <SettingsBlock>
            <p className="flex items-start gap-2 text-xs text-destructive-text">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span>{error}</span>
            </p>
          </SettingsBlock>
        )}
      </SettingsSection>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        onChange={onFile}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      <FormDrawer open={pending !== null} onOpenChange={(o) => !o && setPending(null)} size="sm">
        <FormDrawer.Header>
          <FormDrawer.Title>Replace this browser&apos;s data?</FormDrawer.Title>
          <FormDrawer.Description>
            {pending
              ? `${pending.file} holds ${pending.known.length} ${pending.known.length === 1 ? "entry" : "entries"} from MSO ${pending.blob.appVersion}, saved ${new Date(pending.blob.exportedAt).toLocaleString()}. Your current Playbooks, Agents, Automations, layout and app list are REPLACED, not merged, and MSO reloads. Files on disk are untouched.`
              : ""}
          </FormDrawer.Description>
        </FormDrawer.Header>
        {pending && pending.unknown.length > 0 && (
          <FormDrawer.Body>
            {/* Named, never dropped in silence: an entry this build doesn't own
                is usually a newer MSO's key or the device id, and a user who
                isn't told will assume it restored. */}
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span>
                Not restored ({pending.unknown.length}, unrecognised by this build):{" "}
                <span className="break-all font-mono">{pending.unknown.join(", ")}</span>
              </span>
            </p>
          </FormDrawer.Body>
        )}
        <FormDrawer.Footer>
          <Button type="button" variant="ghost" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={confirmImport} disabled={pending?.known.length === 0}>
            <Upload className="size-4" />
            Replace and reload
          </Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </div>
  );
}
