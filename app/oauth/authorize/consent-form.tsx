"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { approve } from "./actions";
import { followOAuthRedirect } from "./oauth-navigation";
import { defaultConsentScope, type Scope } from "@/lib/mcp/scope";

const TIERS: { value: Scope; label: string; blurb: string }[] = [
  { value: "read", label: "Read only", blurb: "List and read files, disk usage, CPU/memory, processes, installed apps." },
  { value: "write", label: "Read + change settings and files", blurb: "Everything above, plus create, overwrite, move, copy and delete files; change workflows, agent identities, integration connections, project MCP bindings and infrastructure settings such as DNS. This is not file-only access." },
  { value: "exec", label: "Full shell", blurb: "Everything above, plus run any shell command as you, and power the browser session." },
];

export function ConsentForm({
  clientName,
  redirectUri,
  denyUrl,
  ceiling,
  hidden,
}: {
  clientName: string;
  redirectUri: string;
  /**
   * Pre-built on the server from the validated redirect target. `null` only if
   * that target would also be refused on the success path — unreachable from
   * this page today, since it renders no form in that case, but the type keeps
   * it that way rather than trusting the ordering of two files.
   */
  denyUrl: string | null;
  ceiling: Scope;
  hidden: Record<string, string>;
}) {
  const allowed = TIERS.slice(0, TIERS.findIndex((t) => t.value === ceiling) + 1);
  // Preselect the highest tier this deployment permits; the owner may still lower it before allowing.
  const [scope, setScope] = useState<Scope>(defaultConsentScope(ceiling));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      action={async (fd) => {
        setBusy(true);
        setError(null);
        const result = await approve(fd);
        if (result.ok) {
          followOAuthRedirect(result.redirectTo);
          return;
        }
        setBusy(false);
        setError(result.error);
      }}
      className="space-y-5"
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Connect {clientName} to your VPS</h1>
        <p className="text-sm text-muted-foreground">
          It will be able to act on this machine as you, without asking again, until you revoke it in
          Settings → MCP.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs">
        <span className="text-muted-foreground">Sends the result to</span>
        <div className="mt-0.5 truncate font-mono">{redirectUri}</div>
        <p className="mt-2 text-muted-foreground">
          The name above is what the client called itself. Only continue if you just started this
          connection yourself.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">What it may do</legend>
        {allowed.map((t) => (
          <label
            key={t.value}
            className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
          >
            <input
              type="radio"
              name="scope"
              value={t.value}
              checked={scope === t.value}
              onChange={() => setScope(t.value)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t.label}</span>
              <span className="block text-xs text-muted-foreground">{t.blurb}</span>
            </span>
          </label>
        ))}
        {allowed.length < TIERS.length && (
          <p className="text-xs text-muted-foreground">
            Higher tiers are disabled by <code className="font-mono">OS_MCP_MAX_SCOPE</code> on this server.
          </p>
        )}
      </fieldset>

      {scope === "exec" && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          Full shell means whoever holds this token can run any command on this VPS as you, and every
          command you ask for is sent to the client&apos;s provider. Grant it only to a client you trust
          that much.
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="flex-1 [@media(pointer:coarse)]:min-h-[44px]">
          {busy ? "Connecting…" : "Allow"}
        </Button>
        {/* An anchor, not history.back(): declining has to REACH the client, or
            it waits on a callback that never comes and the user is left looking
            at a spinner. `denyUrl` is usually a different origin (chatgpt.com),
            which the Next router does not handle — a plain link does. */}
        {denyUrl ? (
          <Button asChild variant="secondary" className="flex-1 [@media(pointer:coarse)]:min-h-[44px]">
            <a href={denyUrl}>Cancel</a>
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="flex-1 [@media(pointer:coarse)]:min-h-[44px]"
            onClick={() => history.back()}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
