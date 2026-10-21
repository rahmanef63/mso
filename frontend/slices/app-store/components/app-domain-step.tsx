"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FormDrawer } from "@/features/appshell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DOMAIN_POLL_DEADLINE_MS,
  DOMAIN_PROVIDER_IDS,
  directAddressFrom,
  domainProviderCapabilities,
  pollAppDomain,
  providerBlockReason,
  providerLabel,
  targetFor,
  type AppDomainRecord,
  type DomainProviderId,
} from "../lib/app-domain";

// ONE domain step, used by both entry paths (Install a managed app, Connect an
// existing one). Never fork it: the two paths differ only in what they pass in.
// Three steps, in order: hostname, provider, wait/result.
//
// The provider list is COMPLETE and never filtered. A provider that cannot write
// the record type this target needs is rendered disabled WITH the reason — the
// operator must see that Cloudflare is not an option here because Dokploy owns
// the ingress, not have the row silently disappear.
const errorText: Record<string, string> = {
  invalid_hostname: "That hostname is not usable for this app. Use a lowercase DNS name you control.",
  invalid_target: "The record target is not a public IPv4 address or a DNS name.",
  unsupported_provider: "That provider cannot write records for this hostname.",
  domain_conflict: "That hostname already belongs to another app or an existing site.",
  provider_unavailable: "The provider is not configured on this host, or its API refused the write.",
};
const deadlineSeconds = Math.round(DOMAIN_POLL_DEADLINE_MS / 1000);

/** Step 2 on its own: the full provider list, incapable entries disabled in
 *  place. Separate from the drawer so the rules stay renderable and testable. */
export function DomainProviderPicker({ recordType, value, disabled, onSelect }: {
  recordType: "A" | "CNAME"; value: DomainProviderId | null; disabled?: boolean; onSelect: (id: DomainProviderId) => void;
}) {
  return <fieldset className="space-y-1.5">
    <legend className="text-sm font-medium">DNS provider</legend>
    <div className="space-y-2">
      {DOMAIN_PROVIDER_IDS.map(id => {
        const reason = providerBlockReason(id, recordType);
        const capability = domainProviderCapabilities(id);
        return <label key={id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
          <input type="radio" name={`provider-${recordType}`} className="mt-1" value={id} checked={value === id}
            disabled={Boolean(reason) || disabled} onChange={() => onSelect(id)} />
          <span className="min-w-0 space-y-0.5">
            <span className="block">{providerLabel(id)}</span>
            <span className="block text-xs text-muted-foreground">
              {`${capability.aRecord ? "A" : "no A"} · ${capability.cname ? "CNAME" : "no CNAME"} · ${capability.ingress ? "owns ingress" : "DNS only"} · ${capability.txt ? "TXT verification" : "no TXT verification"}`}
            </span>
            {reason ? <span className="block text-xs text-destructive">Unavailable: {reason}</span> : null}
          </span>
        </label>;
      })}
    </div>
    {recordType === "CNAME" && <p className="text-xs text-muted-foreground">This app is addressed by a hostname, so the record type is CNAME.</p>}
  </fieldset>;
}

/** Step 3 result. `phase` is printed verbatim: that string is how the operator
 *  reports where a run stopped. */
export function DomainPhaseSummary({ record }: { record: AppDomainRecord }) {
  return <div className="space-y-1 rounded-lg border p-3 text-sm">
    <p>Phase: <span className="font-mono">{record.phase}</span></p>
    <p className="break-all text-xs text-muted-foreground">{record.hostname} · {record.provider ?? "no provider"}{record.dnsAction ? ` · DNS ${record.dnsAction}` : ""}{record.routeAction ? ` · route ${record.routeAction}` : ""}</p>
    {record.localOrigin && <p className="break-all text-xs text-muted-foreground">Checked locally at {record.localOrigin}</p>}
    {record.phase === "blocked" && <p role="alert" className="text-sm text-destructive">{record.error ?? "Publication is blocked; the provider gave no reason."}</p>}
  </div>;
}

/** The escape hatch, always rendered. It opens a new tab; it never claims that
 *  MSO can embed an address. Only an IP:port address is offered, because that is
 *  the case the iframe guard in components/external-app-frame.tsx refuses. */
export function DomainEscapeHatch({ appTitle, address }: { appTitle: string; address?: string | null }) {
  const direct = directAddressFrom(address);
  return <div className="space-y-1 rounded-lg border border-dashed p-3">
    <p className="text-sm font-medium">Open directly by IP and port instead</p>
    <p className="text-xs text-muted-foreground">This opens {appTitle} in a new browser tab and does not embed it. An HTTP address is never loaded inside MSO.</p>
    {direct
      ? <Button asChild variant="outline" size="sm"><a href={direct} target="_blank" rel="noopener noreferrer">Open {direct}</a></Button>
      : <p className="text-xs text-muted-foreground">No IP-and-port address is known for this app yet. Use its address from the connection list.</p>}
  </div>;
}

export function AppDomainStep({ appId, appTitle, defaultHostname, appAddress, onDone }: {
  appId: string;
  appTitle: string;
  defaultHostname: string;
  /** The app's current address. Drives the target record and the escape hatch. */
  appAddress?: string | null;
  onDone: () => void;
}) {
  const prefix = useId();
  const [hostname, setHostname] = useState(defaultHostname);
  const [provider, setProvider] = useState<DomainProviderId | null>(null);
  const [record, setRecord] = useState<AppDomainRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [stopped, setStopped] = useState<"" | "cancelled" | "deadline">("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const target = targetFor(appAddress ?? "");
  const chosen = provider ?? DOMAIN_PROVIDER_IDS.find(id => providerBlockReason(id, target?.kind === "cname" ? "CNAME" : "A") === null) ?? null;

  const startPoll = useCallback(() => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setWaiting(true);
    setStopped("");
    void pollAppDomain({ appId, signal: next.signal, onRecord: setRecord }).then(outcome => {
      setWaiting(false);
      if (outcome.status === "cancelled") { setStopped("cancelled"); return; }
      if (outcome.status === "deadline") {
        setStopped("deadline");
        if (outcome.error) setError(outcome.error);
      }
    });
  }, [appId]);
  useEffect(() => () => controller.current?.abort(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !chosen) return;
    setError("");
    if (!target) { setError("This app has no IPv4 or DNS address yet. Connect it with an address before publishing a name for it."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/shell-apps/${encodeURIComponent(appId)}/domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: chosen, hostname: hostname.trim(), target }),
      });
      const payload = await response.json() as AppDomainRecord & { error?: string };
      if (!response.ok) throw new Error(errorText[payload.error ?? ""] ?? "Could not publish this domain.");
      setRecord(payload);
      startPoll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not publish this domain.");
    } finally { setBusy(false); }
  };

  const cancelWait = () => { controller.current?.abort(); setWaiting(false); setStopped("cancelled"); };

  return <FormDrawer open onOpenChange={open => { if (!open && !busy) onDone(); }} size="md">
    <FormDrawer.Header>
      <FormDrawer.Title>Domain for {appTitle}</FormDrawer.Title>
      <FormDrawer.Description>Point a hostname you control at this app. DNS is written only after the app answers on this host, so the name never serves an unready service.</FormDrawer.Description>
    </FormDrawer.Header>
    <form onSubmit={submit} className="min-h-0 space-y-4 overflow-y-auto px-4 pb-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-hostname`}>Hostname</Label>
        <Input id={`${prefix}-hostname`} value={hostname} placeholder="app.example.com" required maxLength={253}
          onChange={event => setHostname(event.target.value)} disabled={Boolean(record)} />
        <p className="text-xs text-muted-foreground">Must not be MSO&apos;s own cockpit host or share its sign-in cookie domain.</p>
      </div>

      <DomainProviderPicker recordType={target?.kind === "cname" ? "CNAME" : "A"} value={chosen}
        disabled={Boolean(record)} onSelect={setProvider}/>

      {record && <DomainPhaseSummary record={record}/>}

      {waiting && <p role="status" className="text-xs text-muted-foreground">Waiting for the provider to confirm. Retries with backoff, gives up after {deadlineSeconds} seconds.</p>}
      {stopped === "cancelled" && <p role="status" className="text-xs text-muted-foreground">Stopped waiting at your request. Last phase: <span className="font-mono">{record?.phase ?? "none"}</span>.</p>}
      {stopped === "deadline" && <p role="status" className="text-xs text-muted-foreground">Stopped at the {deadlineSeconds}-second deadline. Last phase: <span className="font-mono">{record?.phase ?? "none"}</span>. Nothing was published silently; check the provider, then check again.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <DomainEscapeHatch appTitle={appTitle} address={appAddress}/>

      <div className="flex flex-wrap justify-end gap-2">
        {waiting && <Button type="button" variant="outline" onClick={cancelWait}>Cancel waiting</Button>}
        {stopped && !waiting && <Button type="button" variant="outline" disabled={busy} onClick={startPoll}>Check again</Button>}
        <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>Close</Button>
        <Button type="submit" disabled={busy || waiting || !chosen || Boolean(record && record.phase !== "blocked")}>
          {busy ? "Publishing…" : record?.phase === "blocked" ? "Try again" : "Publish domain"}
        </Button>
      </div>
    </form>
  </FormDrawer>;
}
