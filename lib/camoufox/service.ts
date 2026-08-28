import "server-only";
import { runProgram } from "@/lib/managed-apps/runner";

// The Camoufox display is a systemd USER unit (`~/.config/systemd/user/`), which is
// the whole reason this module can exist: mso runs as `User=rahman`, so
// `systemctl --user` needs neither sudo nor a polkit rule. It used to be a system
// unit, and then nothing short of a root shell could stop it — the Browser app could
// hide itself from the dock while a headless Firefox + Xvfb + x11vnc kept burning a
// core and 1.5 GB on the host. Turning the app off in the UI now turns the process
// off, because these are the same switch.
//
// Boot survival is `loginctl enable-linger rahman` (already set), NOT the unit.
const UNIT = "camoufox-vnc.service";

export interface CamoufoxServiceStatus {
  /** The unit is up right now. */
  running: boolean;
  /** The unit will come back on its own after a reboot. */
  enabled: boolean;
  /** No such unit on this host — never true on a normal install. */
  installed: boolean;
  /** Loopback noVNC has finished booting and can serve the viewer document. */
  viewerReady?: boolean;
}

/** Parses one `systemctl show -p ...` block. Split out from the spawn so the
 *  property matching is testable without a systemd. */
export function parseUnitShow(stdout: string): CamoufoxServiceStatus {
  const value = (key: string) => new RegExp(`^${key}=(.*)$`, "m").exec(stdout)?.[1]?.trim() ?? "";
  const load = value("LoadState");
  return {
    // `not-found` is what an absent unit reports, and it reports it with rc 0 —
    // ActiveState alone would read `inactive` and be indistinguishable from
    // "installed but stopped" (the same trap documented in managed-apps/manager.ts).
    installed: load !== "" && load !== "not-found",
    running: value("ActiveState") === "active",
    // `enabled-runtime`, `linked`, `static` and friends all mean "comes back";
    // only an explicit `disabled`/`masked` means it stays down.
    enabled: /^(enabled|enabled-runtime|static|linked|generated|indirect)/.test(value("UnitFileState")),
  };
}

async function show(): Promise<CamoufoxServiceStatus> {
  const result = await runProgram(
    "systemctl",
    ["--user", "show", "-p", "LoadState", "-p", "ActiveState", "-p", "UnitFileState", UNIT],
    10_000,
  );
  // A failing systemctl is NOT the same answer as "no such unit", and collapsing
  // the two is how this reports "the browser is not installed on this host" when
  // the truth is that mso cannot reach the user bus at all (a system unit gets
  // no XDG_RUNTIME_DIR unless something sets it — see the mso.service drop-in).
  // Say which one it is; an unfixable-looking panel is worse than an error.
  if (result.code !== 0) {
    throw new Error(`systemctl --user failed (rc ${result.code}): ${result.stderr.trim().slice(0, 200) || "no output"}`);
  }
  return parseUnitShow(result.stdout);
}

const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|\[?::1\]?)$/;

async function probeViewer(): Promise<boolean> {
  const raw = process.env.CAMOUFOX_NOVNC_URL || "http://127.0.0.1:6080";
  let base: URL;
  try { base = new URL(raw); } catch { return false; }
  if ((base.protocol !== "http:" && base.protocol !== "https:") || !LOOPBACK.test(base.hostname)) return false;
  const target = new URL(base);
  target.pathname = "/vnc.html";
  target.search = "";
  try {
    const response = await fetch(target, {
      method: "HEAD",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function camoufoxStatus(): Promise<CamoufoxServiceStatus> {
  const status = await show();
  return { ...status, viewerReady: status.running ? await probeViewer() : false };
}

/** Powers the display on or off for THIS session only — plain `start`/`stop`, never
 *  `enable`/`disable`. Boot autostart is deliberately left off at the host (the unit is
 *  `disabled`, `Restart=no`, with a `RuntimeMaxSec` lease) because what sits behind this
 *  display is a ~1 GB, always-repainting Gecko: it once held a LinkedIn feed open for 26
 *  hours and burned 17 CPU-hours with zero viewers attached. `--now` here is exactly what
 *  re-armed that on every click. `status.enabled` stays an honest readout of the boot
 *  state — this function just never writes it, so running-but-disabled is the normal
 *  steady state now, not a bug. */
export async function setCamoufoxEnabled(on: boolean): Promise<CamoufoxServiceStatus> {
  const status = await show();
  if (!status.installed) throw new Error("camoufox-vnc.service is not installed on this host");

  const result = await runProgram("systemctl", ["--user", on ? "start" : "stop", UNIT], 30_000);
  if (result.code !== 0) {
    throw new Error(`systemctl --user ${on ? "start" : "stop"} failed (rc ${result.code})`);
  }
  return show();
}

/** Revocation kill-switch. A WebSocket is authenticated only at its handshake, so
 * removing a device from the allowlist cannot evict an already-established VNC
 * channel by itself. Stopping the unit tears down websockify, x11vnc and the browser
 * cgroup; a SIGKILL fallback handles a unit that refuses a graceful stop. */
export async function terminateCamoufoxSessions(): Promise<void> {
  let status = await show();
  if (!status.installed || !status.running) return;

  const stopped = await runProgram("systemctl", ["--user", "stop", UNIT], 30_000);
  if (stopped.code !== 0) {
    const killed = await runProgram(
      "systemctl",
      ["--user", "kill", "--kill-who=all", "--signal=SIGKILL", UNIT],
      15_000,
    );
    if (killed.code !== 0) {
      throw new Error(`could not terminate Camoufox sessions (stop rc ${stopped.code}, kill rc ${killed.code})`);
    }
  }

  status = await show();
  if (status.running) {
    const killed = await runProgram(
      "systemctl",
      ["--user", "kill", "--kill-who=all", "--signal=SIGKILL", UNIT],
      15_000,
    );
    if (killed.code !== 0) throw new Error(`Camoufox remained active after stop (kill rc ${killed.code})`);
    status = await show();
  }
  if (status.running) throw new Error("Camoufox remained active after forced termination");
}
