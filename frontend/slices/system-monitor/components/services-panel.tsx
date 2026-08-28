"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, FileText, Loader2, Play, RotateCw, Search, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormDrawer, toast } from "@/features/os-shell";
import { GlassPanel } from "./glass-panel";
import { useOsApi, type ServiceAction, type ServiceInventory, type ServiceLogs, type SystemService } from "../lib/host";

export function ServicesPanel() {
  const api = useOsApi();
  const [inventory, setInventory] = useState<ServiceInventory | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<ServiceLogs | null>(null);
  const [pending, setPending] = useState<{ service: SystemService; action: ServiceAction } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setInventory(await api.sys.services());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [api]);

  useEffect(() => {
    let alive = true;
    api.sys.services()
      .then((value) => { if (alive) setInventory(value); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { alive = false; };
  }, [api]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return inventory?.services ?? [];
    return (inventory?.services ?? []).filter((service) =>
      `${service.unit} ${service.description} ${service.scope} ${service.active} ${service.sub}`.toLowerCase().includes(needle),
    );
  }, [inventory, query]);

  const power = useCallback(async (service: SystemService, action: ServiceAction) => {
    const key = `${service.scope}:${service.unit}`;
    setBusy(key);
    try {
      await api.sys.servicePower(service.scope, service.unit, action);
      toast(`${service.unit}: ${action} completed`);
      await load();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Service action failed", { tone: "error" });
    } finally {
      setBusy(null);
    }
  }, [api, load]);

  const readLogs = useCallback(async (service: SystemService) => {
    setBusy(`logs:${service.scope}:${service.unit}`);
    try {
      setLogs(await api.sys.serviceLogs(service.scope, service.unit, 160));
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Couldn't read service logs", { tone: "error" });
    } finally {
      setBusy(null);
    }
  }, [api]);

  if (!inventory && !error) {
    return <Loading label="Reading systemd inventory…" />;
  }
  if (error) {
    return <Failure message={error} retry={load} />;
  }

  return (
    <div className="space-y-3.5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services" className="pl-8" />
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}><RotateCw className="size-3.5" /> Refresh</Button>
      </div>

      {!inventory?.controlAllowlistConfigured && (
        <div className="rounded-lg border border-border bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
          Inventory is read-only. An owner can enable exact units with <code>OS_SERVICE_CONTROL_UNITS=user:mso.service,system:nginx.service</code>. Wildcards are rejected.
        </div>
      )}
      {api.mode === "live" && !api.access.canOperate && (
        <div className="rounded-lg border border-border bg-muted/35 p-3 text-xs text-muted-foreground">
          Current role: <strong className="text-foreground">{api.access.role}</strong>. Service logs and allowlisted lifecycle actions require Operator or Owner.
        </div>
      )}
      {inventory?.diagnostics.map((diagnostic) => (
        <p key={diagnostic} className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">{diagnostic}</p>
      ))}

      <div className="space-y-2">
        {rows.map((service) => {
          const key = `${service.scope}:${service.unit}`;
          const running = service.active === "active";
          const canOperate = service.controllable && api.access.canOperate;
          return (
            <div key={key} className="rounded-xl border border-[color:var(--sep)] bg-[color:var(--glass-panel)] p-3">
              <div className="flex flex-wrap items-start gap-3">
                <span className={`mt-1 size-2.5 shrink-0 rounded-full ${running ? "bg-emerald-500" : service.active === "failed" ? "bg-destructive" : "bg-muted-foreground/45"}`} />
                <div className="min-w-[11rem] flex-1">
                  <p className="break-all font-mono text-xs font-semibold text-foreground">{service.unit}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{service.description || "No description"}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="outline">{service.scope}</Badge>
                    <Badge variant={running ? "default" : "secondary"}>{service.active}/{service.sub}</Badge>
                    {service.controllable && <Badge variant="outline">allowlisted</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {api.access.canOperate && (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void readLogs(service)}>
                      {busy === `logs:${key}` ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />} Logs
                    </Button>
                  )}
                  {canOperate && !running && (
                    <Button size="sm" disabled={busy === key} onClick={() => void power(service, "start")}><Play className="size-3.5" /> Start</Button>
                  )}
                  {canOperate && running && (
                    <>
                      <Button size="sm" variant="outline" disabled={busy === key} onClick={() => setPending({ service, action: "restart" })}><RotateCw className="size-3.5" /> Restart</Button>
                      <Button size="sm" variant="destructive" disabled={busy === key} onClick={() => setPending({ service, action: "stop" })}><Square className="size-3.5" /> Stop</Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!rows.length && <p className="py-8 text-center text-xs text-muted-foreground">No matching services.</p>}
      </div>

      {logs && (
        <GlassPanel title={`${logs.scope}:${logs.unit}`} right={logs.available ? `${logs.entries.length} lines` : "unavailable"}>
          {logs.available ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-foreground">{logs.entries.join("\n") || "No journal entries."}</pre>
          ) : <p className="text-xs text-destructive">{logs.diagnostic || "Journal unavailable"}</p>}
        </GlassPanel>
      )}

      <FormDrawer open={pending !== null} onOpenChange={(open) => !open && setPending(null)} size="sm">
        <FormDrawer.Header>
          <FormDrawer.Title>{pending ? `${pending.action} ${pending.service.unit}?` : "Service action"}</FormDrawer.Title>
          <FormDrawer.Description>This exact unit is owner-allowlisted. The action is audited and runs without a shell.</FormDrawer.Description>
        </FormDrawer.Header>
        <FormDrawer.Footer>
          <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
          <Button variant={pending?.action === "stop" ? "destructive" : "default"} onClick={() => {
            if (pending) void power(pending.service, pending.action);
            setPending(null);
          }}>{pending?.action || "Confirm"}</Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center gap-2 p-8 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />{label}</div>;
}

function Failure({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"><AlertCircle className="size-6 text-destructive" /><p className="text-xs text-muted-foreground">{message}</p><Button size="sm" variant="outline" onClick={() => void retry()}>Retry</Button></div>;
}
