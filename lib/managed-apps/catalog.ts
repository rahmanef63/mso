import { homedir } from "node:os";
import { isAbsolute, join, normalize, sep } from "node:path";
import { MANAGED_APP_IDS, type ManagedAppDefinition, type ManagedAppId } from "./types";

/** Env overrides are hand-written, so a leading `~` is expected — `join()` alone would
 *  keep it literal and every path built from it would silently miss. */
export function expandHome(value: string | undefined): string {
  if (!value) return "";
  if (value === "~") return homedir();
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

/** Orca's managed root is MSO-owned state (`~/.local/share/mso/orca`), never the
 *  operator's personal `~/.orca`. Mirrors the bridge (`orca-private-fs.ts`) so
 *  backup/restore reads the same directory the runtime writes; an invalid
 *  ORCA_HOME override falls back to the portable default here, while the bridge
 *  itself fails closed on it. */
function orcaManagedRoot(): string {
  const fallback = join(homedir(), ".local", "share", "mso", "orca");
  const raw = process.env.ORCA_HOME;
  if (!raw || raw.trim() === "" || raw.includes("\0") || !isAbsolute(raw)) return fallback;
  const normalized = normalize(raw);
  if (normalized !== raw || normalized.split(sep).includes("..")) return fallback;
  return normalized;
}

const definitions = {
  hermes: {
    id: "hermes",
    installBackends: ["user-systemd", "docker"],
    name: "Hermes",
    description: "Hermes Agent runtime and dashboard",
    command: "hermes",
    // Both units are real on a machine installed through MSO: `hermes gateway install`
    // creates hermes-gateway.service, and scripts/managed-app-install writes
    // hermes-dashboard.service itself because upstream ships no installer for it.
    // Dashboard stays FIRST and that ordering is load-bearing — it is the unit serving
    // dashboardUrl below, so it remains the primary log/health surface; lifecycle
    // and quiescence checks cover every installed unit/container. The gateway is messaging plumbing (Telegram,
    // Discord, WhatsApp) and binds nothing on 9119; ranking it first would report a
    // healthy Hermes while the iframe showed a connection refused.
    serviceNames: ["hermes-dashboard.service", "hermes-gateway.service", "hermes.service"],
    containerNames: ["hermes", "hermes-dashboard"],
    dashboardUrl: process.env.HERMES_DASHBOARD_URL ?? "http://127.0.0.1:9119",
    healthPath: "/api/health",
    stateDirName: ".hermes",
    homeDir: expandHome(process.env.HERMES_HOME),
    gradient: "linear-gradient(160deg,#8b5cf6,#4f46e5)",
  },
  openclaw: {
    id: "openclaw",
    installBackends: ["user-systemd"],
    name: "OpenClaw",
    description: "OpenClaw runtime and control surface",
    command: "openclaw",
    // Live unit first for log display; lifecycle/quiescence includes every installed name.
    serviceNames: ["openclaw-gateway.service", "openclaw.service"],
    containerNames: ["openclaw", "openclaw-gateway"],
    dashboardUrl: process.env.OPENCLAW_DASHBOARD_URL ?? "http://127.0.0.1:18789",
    stateDirName: ".openclaw",
    gradient: "linear-gradient(160deg,#f97316,#dc2626)",
  },
  "9router": {
    id: "9router",
    installBackends: ["docker"],
    name: "9Router",
    description: "9Router AI gateway — one endpoint routing coding agents across 40+ providers",
    // Upstream ships BOTH an npm CLI and Docker images. MSO deliberately manages
    // the Docker form on servers/VPSes (the upstream README recommends Docker for
    // that case). `command` is therefore MSO's lifecycle/update adapter, not the
    // upstream `9router` launcher. commandProvesInstall stays false because this
    // repo-owned adapter exists on every checkout, installed or not.
    command: join(process.cwd(), "scripts", "managed-app-9router"),
    commandProvesInstall: false,
    serviceNames: [],
    containerNames: ["9router"],
    dashboardUrl: process.env.NINE_ROUTER_DASHBOARD_URL ?? "http://127.0.0.1:20128",
    healthPath: "/api/health",
    // Loopback is the secure default. Direct public-IP access is an explicit operator
    // choice because 9Router stores provider credentials and is not an MSO auth surface.
    publicPort: process.env.NINE_ROUTER_EXPOSE_PUBLIC === "1" ? 20128 : undefined,
    publicUrl: process.env.NINE_ROUTER_PUBLIC_URL,
    stateDirName: ".9router",
    gradient: "linear-gradient(160deg,#0ea5e9,#2563eb)",
  },
  orca: {
    id: "orca",
    // Orca is installed as the MSO-owned `mso-orca.service` user unit from the
    // pinned web/Node release (linux x64 glibc). It is not a Docker app.
    installBackends: ["user-systemd"],
    name: "Orca",
    description: "Orca web workspace and coding environment",
    // The lifecycle/update adapter ships in THIS repo, so its presence proves
    // nothing; only the exact unit plus a verified install receipt count.
    command: join(process.cwd(), "scripts", "managed-app-orca"),
    commandProvesInstall: false,
    serviceNames: ["mso-orca.service"],
    containerNames: [],
    dashboardUrl: process.env.ORCA_DASHBOARD_URL ?? "http://127.0.0.1:6769",
    healthPath: "/web-index.html",
    stateDirName: "orca",
    homeDir: orcaManagedRoot(),
    gradient: "linear-gradient(160deg,#0284c7,#1e3a8a)",
  },
} as const satisfies Record<ManagedAppId, ManagedAppDefinition>;

export function isManagedAppId(value: string): value is ManagedAppId {
  return (MANAGED_APP_IDS as readonly string[]).includes(value);
}

export function getManagedAppDefinition(id: ManagedAppId): ManagedAppDefinition {
  return definitions[id];
}

export function listManagedAppDefinitions(): ManagedAppDefinition[] {
  return MANAGED_APP_IDS.map((id) => definitions[id]);
}
