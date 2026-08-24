import { homedir } from "node:os";
import { join } from "node:path";
import { MANAGED_APP_IDS, type ManagedAppDefinition, type ManagedAppId } from "./types";

/** Env overrides are hand-written, so a leading `~` is expected — `join()` alone would
 *  keep it literal and every path built from it would silently miss. */
export function expandHome(value: string | undefined): string {
  if (!value) return "";
  if (value === "~") return homedir();
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

const definitions = {
  hermes: {
    id: "hermes",
    name: "Hermes",
    description: "Hermes Agent runtime and dashboard",
    command: "hermes",
    // Both units are real on a machine installed through MSO: `hermes gateway install`
    // creates hermes-gateway.service, and scripts/managed-app-install writes
    // hermes-dashboard.service itself because upstream ships no installer for it.
    // Dashboard stays FIRST and that ordering is load-bearing — it is the unit serving
    // dashboardUrl below, so it is what start/stop must act on and what "is there
    // anything to frame" must read. The gateway is messaging plumbing (Telegram,
    // Discord, WhatsApp) and binds nothing on 9119; ranking it first would report a
    // healthy Hermes while the iframe showed a connection refused.
    serviceNames: ["hermes-dashboard.service", "hermes-gateway.service", "hermes.service"],
    containerNames: ["hermes", "hermes-dashboard"],
    dashboardUrl: process.env.HERMES_DASHBOARD_URL ?? "http://127.0.0.1:9119",
    stateDirName: ".hermes",
    homeDir: expandHome(process.env.HERMES_HOME),
    gradient: "linear-gradient(160deg,#8b5cf6,#4f46e5)",
  },
  openclaw: {
    id: "openclaw",
    name: "OpenClaw",
    description: "OpenClaw runtime and control surface",
    command: "openclaw",
    // Live unit first: `openclaw.service` does not exist on this host, and detection
    // stops at the first name whose LoadState is not `not-found`.
    serviceNames: ["openclaw-gateway.service", "openclaw.service"],
    containerNames: ["openclaw", "openclaw-gateway"],
    dashboardUrl: process.env.OPENCLAW_DASHBOARD_URL ?? "http://127.0.0.1:18789",
    stateDirName: ".openclaw",
    gradient: "linear-gradient(160deg,#f97316,#dc2626)",
  },
  "9router": {
    id: "9router",
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
    // The Docker install publishes this port on 0.0.0.0. That gives a fresh MSO
    // installation a usable UI without requiring DNS, TLS or a domain provider.
    // Embedding inside HTTPS MSO remains a separate optional split-origin feature.
    publicPort: 20128,
    stateDirName: ".9router",
    gradient: "linear-gradient(160deg,#0ea5e9,#2563eb)",
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
