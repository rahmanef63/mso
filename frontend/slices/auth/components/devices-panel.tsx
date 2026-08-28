"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ShieldCheck, Trash2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton, FormDrawer, toast } from "@/features/os-shell";
import { getOrCreateDeviceId } from "../lib/device";
import { DEVICE_ROLES, roleLabel, type DeviceRole } from "@/lib/auth/roles";

type Device = {
  deviceId: string;
  label: string;
  status: "approved" | "pending";
  role?: DeviceRole;
};
type DevicesResponse = {
  approved?: Record<string, { label?: string; role?: DeviceRole }>;
  pending?: Record<string, { label?: string }>;
};

function flatten(r: DevicesResponse): Device[] {
  const approved = Object.entries(r.approved ?? {}).map(
    ([deviceId, d]): Device => ({
      deviceId,
      label: d.label || "device",
      status: "approved",
      role: d.role || "owner",
    }),
  );
  const pending = Object.entries(r.pending ?? {}).map(
    ([deviceId, d]): Device => ({ deviceId, label: d.label || "device", status: "pending" }),
  );
  return [...pending, ...approved];
}

export function DevicesPanel() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [pendingRoles, setPendingRoles] = useState<Record<string, DeviceRole>>({});
  const [pendingRevoke, setPendingRevoke] = useState<Device | null>(null);
  const thisId = typeof window !== "undefined" ? getOrCreateDeviceId() : "";

  const fetchDevices = useCallback(async (): Promise<Device[]> => {
    const response = await fetch("/api/auth/devices", { cache: "no-store" });
    if (!response.ok) throw new Error("Owner role is required to manage devices");
    return flatten((await response.json()) as DevicesResponse);
  }, []);

  const load = useCallback(async () => {
    try {
      setDevices(await fetchDevices());
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't load devices", { tone: "error" });
      setDevices([]);
    }
  }, [fetchDevices]);

  useEffect(() => {
    let alive = true;
    fetchDevices()
      .then((rows) => alive && setDevices(rows))
      .catch(() => alive && setDevices([]));
    return () => { alive = false; };
  }, [fetchDevices]);

  const act = useCallback(async (
    action: "approve" | "revoke" | "set_role",
    deviceId: string,
    role?: DeviceRole,
  ) => {
    try {
      const response = await fetch("/api/auth/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, deviceId, role }),
      });
      const body = (await response.json().catch(() => ({}))) as DevicesResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || "Device change failed");
      setDevices(flatten(body));
      toast(action === "approve" ? "Device approved" : action === "revoke" ? "Device revoked" : "Device role updated");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Device change failed", { tone: "error" });
      await load();
    }
  }, [load]);

  const ownerCount = useMemo(
    () => devices?.filter((device) => device.status === "approved" && device.role === "owner").length ?? 0,
    [devices],
  );

  if (devices === null) return <p className="text-xs text-muted-foreground">Loading devices…</p>;
  if (devices.length === 0) return <p className="text-xs text-muted-foreground">No devices registered.</p>;

  return (
    <>
      <div className="mb-3 rounded-lg border border-border/70 bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Viewer</strong> reads files and telemetry. <strong className="text-foreground">Operator</strong> also runs bounded service/app actions. <strong className="text-foreground">Owner</strong> can write files, open shells, change credentials, and manage access.
      </div>
      <ul className="space-y-2">
        {devices.map((device) => {
          const pendingRole = pendingRoles[device.deviceId] ?? "viewer";
          const cannotDemoteLastOwner = device.role === "owner" && ownerCount <= 1;
          return (
            <li key={device.deviceId} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/50 p-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                {device.status === "approved" ? <ShieldCheck className="size-4" /> : <Clock className="size-4" />}
              </span>
              <div className="min-w-[9rem] flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {device.label}
                  {device.deviceId === thisId && <Badge variant="outline">This device</Badge>}
                </p>
                <span className="truncate font-mono text-[11px] text-muted-foreground">…{device.deviceId.slice(-6)}</span>
                <CopyButton value={device.deviceId} label="full device ID" history={false} />
              </div>

              {device.status === "pending" ? (
                <div className="flex items-center gap-2">
                  <RoleSelect
                    value={pendingRole}
                    onChange={(role) => setPendingRoles((current) => ({ ...current, [device.deviceId]: role }))}
                  />
                  <Button size="sm" onClick={() => void act("approve", device.deviceId, pendingRole)}>
                    <Check className="size-3.5" /> Approve
                  </Button>
                </div>
              ) : device.deviceId === thisId ? (
                <Badge>{roleLabel(device.role ?? "owner")}</Badge>
              ) : (
                <RoleSelect
                  value={device.role ?? "owner"}
                  disabled={cannotDemoteLastOwner}
                  title={cannotDemoteLastOwner ? "Approve another owner before changing this role" : undefined}
                  onChange={(role) => void act("set_role", device.deviceId, role)}
                />
              )}

              {device.deviceId !== thisId && (
                <Button size="icon" variant="ghost" aria-label="Revoke device" onClick={() => setPendingRevoke(device)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <FormDrawer open={pendingRevoke !== null} onOpenChange={(open) => !open && setPendingRevoke(null)} size="sm">
        <FormDrawer.Header>
          <FormDrawer.Title>
            {pendingRevoke ? `Revoke device "${pendingRevoke.label}"?` : "Revoke device?"}
          </FormDrawer.Title>
          <FormDrawer.Description>
            New requests are rejected immediately. Any live Camoufox viewer is terminated; the device must be approved again before it can sign in.
          </FormDrawer.Description>
        </FormDrawer.Header>
        <FormDrawer.Footer>
          <Button type="button" variant="ghost" onClick={() => setPendingRevoke(null)}>Cancel</Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (pendingRevoke) void act("revoke", pendingRevoke.deviceId);
              setPendingRevoke(null);
            }}
          >
            <Trash2 className="size-4" /> Revoke
          </Button>
        </FormDrawer.Footer>
      </FormDrawer>
    </>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled,
  title,
}: {
  value: DeviceRole;
  onChange: (role: DeviceRole) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <select
      aria-label="Device role"
      value={value}
      disabled={disabled}
      title={title}
      onChange={(event) => onChange(event.target.value as DeviceRole)}
      className="min-h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      {DEVICE_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
    </select>
  );
}
