"use client";

import { useState } from "react";
import { Copy, RotateCcw, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDrawer } from "@/features/appshell";
import { SettingsSection, SettingsBlock } from "@/features/shell-settings";
import { browserResetKeys, resetBrowserState, type BrowserResetScope } from "../lib/browser-reset";

const COMMANDS = [
  ["Reset server configuration", "mso reset"],
  ["Factory reset server state", "mso reset --scope all"],
  ["Uninstall, keep server data", "mso uninstall"],
  ["Uninstall and purge owned data/code", "mso uninstall --purge --remove-code"],
] as const;

export function MaintenanceSection() {
  const [scope, setScope] = useState<BrowserResetScope>("appearance");
  const [pending, setPending] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const preview = () => {
    try { setError(null); setPending(browserResetKeys(localStorage, scope)); }
    catch { setError("Browser storage is unavailable. Nothing was reset."); }
  };
  const apply = () => {
    try { resetBrowserState(localStorage, scope); window.location.reload(); }
    catch { setError("The browser reset did not complete. Review your browser storage permissions."); setPending(null); }
  };
  const copy = async (command: string) => {
    try { await navigator.clipboard.writeText(command); setCopied(command); }
    catch { setError("Copy failed. Select the command text and copy it manually."); }
  };
  return (
    <>
      <SettingsSection icon={<RotateCcw />} title="Reset this browser" footnote="Keeps device approval and server files. Server-synced appearance and Quicklinks can return after signing in; use server configuration reset to clear those too.">
        <SettingsBlock>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select value={scope} onValueChange={(value) => setScope(value as BrowserResetScope)}>
              <SelectTrigger className="min-h-11 flex-1" aria-label="Browser reset scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="appearance">Appearance only</SelectItem>
                <SelectItem value="browser">All MSO browser data</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" className="min-h-11" onClick={preview}>Preview reset</Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Export a browser backup in Settings → Backup before clearing Playbooks, layouts or drafts.</p>
          {error && <p role="alert" className="mt-2 text-xs text-destructive-text">{error}</p>}
        </SettingsBlock>
      </SettingsSection>
      <SettingsSection icon={<TerminalSquare />} title="Server reset & uninstall" footnote="Run on the server through an independent SSH/local terminal. These commands only preview changes. Applying requires the current preview token and stopped MSO runtimes; it is not available through a browser button.">
        <SettingsBlock>
          <div className="space-y-3">
            {COMMANDS.map(([label, command]) => (
              <div key={command} className="min-w-0">
                <p className="mb-1 text-xs font-medium">{label}</p>
                <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 p-2">
                  <code className="min-w-0 flex-1 select-text break-words text-xs leading-6">{command}</code>
                  <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void copy(command)}><Copy className="size-4" /></Button>
                </div>
              </div>
            ))}
          </div>
          <p role="status" className="mt-2 text-xs text-muted-foreground">{copied ? "Preview command copied. No server action was executed." : "Reset creates a private recovery archive. Purge permanently removes known MSO data, including reset archives."}</p>
          <p className="mt-2 text-xs text-muted-foreground">Other projects, shared dependencies, DNS/TLS, external apps and browser profiles stay untouched. Unknown files and linked worktrees are preserved and reported.</p>
        </SettingsBlock>
      </SettingsSection>
      <FormDrawer open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }} size="sm">
        <FormDrawer.Header>
          <FormDrawer.Title>Reset {scope === "appearance" ? "browser appearance" : "MSO browser data"}?</FormDrawer.Title>
          <FormDrawer.Description>{pending?.length ?? 0} local storage entries will be removed. Device identity and server data remain. Unsaved local drafts cannot be recovered without a backup.</FormDrawer.Description>
        </FormDrawer.Header>
        <FormDrawer.Footer>
          <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="destructive" disabled={!pending?.length} onClick={apply}>Reset this browser</Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </>
  );
}
