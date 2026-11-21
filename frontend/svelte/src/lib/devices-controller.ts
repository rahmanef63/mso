import { ApiError, mutateDevice, readDevices, type DeviceInventory, type DeviceRole } from "./host-api.ts";

export type DevicesState =
  | { kind: "loading" }
  | { kind: "ready"; inventory: DeviceInventory; busyId: string | null; notice: string | null; error: string | null }
  | { kind: "error"; message: string };

export function createDevicesController(update: (state: DevicesState) => void, fetcher = fetch) {
  let generation = 0;
  let active: AbortController | undefined;
  let disposed = false;
  let current: DeviceInventory | null = null;

  async function refresh() {
    if (disposed) return;
    const run = ++generation;
    active?.abort();
    const controller = active = new AbortController();
    update({ kind: "loading" });
    try {
      const inventory = await readDevices(controller.signal, fetcher);
      if (disposed || run !== generation) return;
      current = inventory;
      update({ kind: "ready", inventory, busyId: null, notice: null, error: null });
    } catch (error) {
      if (disposed || run !== generation || controller.signal.aborted) return;
      update({
        kind: "error",
        message: error instanceof ApiError ? error.message : "Could not load approved devices. Check backend and retry.",
      });
    }
  }

  async function runAction(input: { action: "approve" | "set_role" | "revoke"; deviceId: string; label?: string; role?: DeviceRole }) {
    if (disposed || !current) return;
    const run = ++generation;
    active?.abort();
    const controller = active = new AbortController();
    update({ kind: "ready", inventory: current, busyId: input.deviceId, notice: null, error: null });
    try {
      const inventory = await mutateDevice(input, controller.signal, fetcher);
      if (disposed || run !== generation) return;
      current = inventory;
      const verb = input.action === "approve" ? "Device approved." : input.action === "set_role" ? "Device role updated." : "Device revoked.";
      update({ kind: "ready", inventory, busyId: null, notice: verb, error: null });
    } catch (error) {
      if (disposed || run !== generation || controller.signal.aborted) return;
      const message = error instanceof ApiError ? error.message : "Could not update device. Retry when reachable.";
      update({ kind: "ready", inventory: current, busyId: null, notice: null, error: message });
    }
  }

  return {
    refresh,
    approve: (deviceId: string, label: string, role: DeviceRole = "viewer") => runAction({ action: "approve", deviceId, label, role }),
    setRole: (deviceId: string, role: DeviceRole) => runAction({ action: "set_role", deviceId, role }),
    revoke: (deviceId: string) => runAction({ action: "revoke", deviceId }),
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}
