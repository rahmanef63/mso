import type { SliceBudgetEntry } from "./types";
import { STATIC, poll, withWorker } from "./profiles";
import { idle, limited } from "./registry-entry";

/**
 * The registry: one entry per feature slice under frontend/slices.
 *
 * Enforced by registry.test.ts: every slice directory has exactly one entry, every
 * number is cited at file:line or explicitly POLICY/unmeasured, and
 * `externalCallsPerMinute` is null unless this repository limits that slice's calls
 * (null means "no ceiling known", never "no cost").
 */
export const REGISTRY: readonly SliceBudgetEntry[] = [
  limited(
    "agent-group",
    withWorker(STATIC, "lib/agent-group/hermes-runner.ts", 57),
    { max: 30, file: "lib/agent-group/http.ts", line: 45, note: "agent-groups limiter: 30 for action=run, 60 otherwise, per device" },
    "Runs several Hermes profiles per discussion: each turn spawns a headless child (lib/agent-group/hermes-runner.ts:57) under a 30/min run limiter.",
  ),
  limited(
    "agent-vault",
    STATIC,
    { max: 60, file: "lib/mcp/tools-agent-vault.ts", line: 9, note: "agent.vault.read limiter: 60 per 60 s; sync is the tighter 10/min at line 19" },
    "Reads the private progress vault through fs and memory-graph; vault sync is the tighter 10/min budget.",
  ),
  limited(
    "app-store",
    withWorker(poll(30_000, "frontend/slices/app-store/lib/shell-apps.tsx", 48), "frontend/slices/app-store/components/app-console.tsx", 43),
    { max: 20, file: "lib/surfaces/shell-apps-service.ts", line: 28, note: "shell-app limiter: 20 per 60 s per device" },
    "Visible-tab-only poll at 30 s; running a catalog app entry is a real host command (components/app-console.tsx:43), so this slice can spawn work.",
  ),
  limited(
    "appshell",
    poll(20_000, "frontend/slices/appshell/components/menu-bar-status.tsx", 86),
    { max: 20, file: "lib/surfaces/shell-apps-service.ts", line: 28, note: "shell-app limiter: 20 per 60 s per device, the shell's own surface budget" },
    "Generic shell framework: menu-bar status polls at 20 s and its own server call is logout plus shell-app reads.",
  ),
  limited(
    "assistant",
    withWorker(poll(1_000, "frontend/slices/assistant/components/mcp-activity-view.tsx", 115), "frontend/slices/assistant/host-tools/catalog-mutate.ts", 150),
    { max: 120, file: "app/mcp/handler.ts", line: 22, note: "CALLS_PER_MIN = 120 per MCP token per minute" },
    "Streams turns, reads MCP activity once a second and runs approved host commands (host-tools/catalog-mutate.ts:150), so it can spawn work.",
  ),
  limited(
    "auth",
    poll(60_000, "frontend/slices/auth/lib/use-session.tsx", 101),
    { max: 30, file: "app/api/auth/login/handler.ts", line: 25, note: "GLOBAL_MAX_ATTEMPTS = 30 login attempts per window; per IP it is the tighter 5 at line 22" },
    "Session revalidation every 60 s. Login is the slice's only externally limited call and keeps its own specialised limiter.",
  ),
  limited(
    "camoufox-browser",
    STATIC,
    { max: 12, file: "lib/camoufox/http.ts", line: 36, note: "camoufox limiter: 12 per 60 s" },
    "Powers a real browser through a systemd user unit; lifecycle is a spawned service behind the 12/min limiter.",
  ),
  limited(
    "channels",
    STATIC,
    { max: 120, file: "lib/channels/service.ts", line: 129, note: "channel-authenticated limiter: 120 per 60 s per channel id" },
    "Sends to Telegram/Discord: genuine external provider traffic under the 120/min channel limiter.",
  ),
  limited(
    "code-editor",
    withWorker(STATIC, "frontend/slices/code-editor/app.tsx", 175),
    { max: 120, file: "lib/mcp/tools-edit.ts", line: 13, note: "fs.edit limiter: 120 edits per 60 s" },
    "Embeds the Terminal component, so it can start a PTY from its own surface (app.tsx:175); its own traffic is edits behind the 120/min limiter.",
  ),
  idle(
    "create-app",
    STATIC,
    "Authors an app manifest in the browser. No fetch, /api call or host operation appears in this slice's tree, and the manifest is registered elsewhere.",
  ),
  idle(
    "docs",
    STATIC,
    "In-app documentation browser over bundled content: no fetch, /api call or host operation in this slice's tree.",
  ),
  limited(
    "extensions",
    STATIC,
    { max: 120, file: "lib/mcp/tools-project-mcp-manage.ts", line: 11, note: "project.mcp.manage: 20/min, with an explicit inspect override of 120/min" },
    "Installs and inspects project MCP servers and skills; inspection runs at the 120/min override.",
  ),
  limited(
    "files-manager",
    STATIC,
    { max: 120, file: "lib/mcp/tools-edit.ts", line: 13, note: "fs.edit limiter: 120 edits per 60 s, the highest fs mutation budget" },
    "Reads and mutates the host filesystem through /api/v1/fs; each listing is response-bounded (lib/host/fs-enumeration.ts:9).",
  ),
  idle(
    "icon-picker",
    STATIC,
    "Emoji/Lucide/Phosphor picker over bundled catalogs with a local recents cap (lib/recents-core.ts:2, MAX = 24): no server call.",
  ),
  limited(
    "image-editor",
    STATIC,
    { max: 120, file: "lib/mcp/tools-edit.ts", line: 13, note: "document and raster saves go through the bounded fs write/edit path" },
    "Layered raster work is client-side; persistence is bounded fs writes.",
  ),
  limited(
    "image-picker",
    STATIC,
    { max: 20, file: "app/api/v1/stock/providers.ts", line: 40, note: "OPENVERSE_ANON_MAX_PAGE_SIZE = 20 results per anonymous upstream call" },
    "Stock search is a keyless external call with a 20-result page cap; that route declares no request-rate limiter, so the page cap is the cited ceiling.",
  ),
  limited(
    "infrastructure",
    STATIC,
    { max: 20, file: "lib/mcp/tools-infra.ts", line: 58, note: "infra.dokploy 20/min, Cloudflare 20 (line 86), Hostinger 10 (line 96)" },
    "Provider inventory reads and DNS/ingress writes; DNS writes are external provider calls under the same limiter.",
  ),
  limited(
    "integrations",
    STATIC,
    { max: 30, file: "lib/mcp/tools-integrations.ts", line: 23, note: "integration.execute limiter: 30 per 60 s" },
    "Native connection manager: every provider operation is an external call at 30/min. Its UI is a native DOM surface, not React traffic.",
  ),
  limited(
    "managed-apps",
    poll(10_000, "frontend/slices/managed-apps/app.tsx", 39),
    { max: 12, file: "lib/mcp/tools-power.ts", line: 13, note: "managed-app limiter: 12 per 60 s per app id" },
    "Lifecycle, update and backup for Hermes/OpenClaw; a job child is spawned (lib/managed-apps/job-child.ts:78) behind the 12/min limiter.",
  ),
  limited(
    "media-studio",
    STATIC,
    { max: 120, file: "lib/mcp/tools-edit.ts", line: 13, note: "saves land on /api/v1/fs/upload (lib/save-image.ts:62), inside the shared 120/min edit budget" },
    "Composes media in the browser and uploads it; no server compute beyond the bounded upload.",
  ),
  limited(
    "media-viewer",
    STATIC,
    { max: 16, file: "app/api/v1/fs/raw/handler.ts", line: 10, note: "readAdmission(4, 16): 4 concurrent raw streams per actor, 16 globally" },
    "Streams raw bytes with Range requests; the honest ceiling is the raw-stream admission budget, not a request-per-minute limit.",
  ),
  limited(
    "memory-graph",
    STATIC,
    { max: 160, file: "lib/memory-graph/vault.ts", line: 10, note: "MAX_FILES = 160 per graph build; depth 6, 48 KiB/note (lines 11-13)" },
    "Builds one bounded graph per request rather than scanning the vault unbounded.",
  ),
  limited(
    "n8n",
    STATIC,
    { max: 20, file: "lib/host/workflow-embeds-service.ts", line: 28, note: "workflow-embed limiter: 20 per 60 s per device" },
    "Reads the reviewed n8n workspace through workflow embeds at 20/min.",
  ),
  limited(
    "organization",
    STATIC,
    { max: 40, file: "lib/agent/organization-service.ts", line: 72, note: "organization limiter: 40 per 60 s per device" },
    "Owner-private chart mutations at 40/min; reads are bounded by a 2 MiB store rather than a call count.",
  ),
  limited(
    "os-settings",
    poll(3_000, "frontend/slices/os-settings/components/update-section.tsx", 14),
    { max: 6, file: "lib/host/sys-update-service.ts", line: 26, note: "sys-update-check limiter: 6 checks per 60 s" },
    "Settings polls update state at 3 s but the update check itself is the tighter 6/min host limiter.",
  ),
  limited(
    "os-shell",
    poll(3_000, "frontend/slices/os-shell/capabilities.ts", 19),
    { max: 30, file: "lib/host/sys-services-service.ts", line: 14, note: "the shell's telemetry poll lands on the 30/min sys-services limiter" },
    "MSO consumer manifest: wires appearance, stats and search into the generic shell; its own poll is the 3 s telemetry tick.",
  ),
  limited(
    "os-terminal",
    withWorker(STATIC, "lib/host/pty.ts", 22),
    { max: 20, file: "lib/host/term-service.ts", line: 16, note: "OPEN_MAX = 20 shell opens per 60 s per actor" },
    "Opens real PTYs: 8 live shells (lib/host/pty.ts:22) inside a 20/min open limiter.",
  ),
  idle(
    "quicklinks",
    STATIC,
    "Shortcut metadata held in browser layout: no fetch, /api call or host operation in this slice's tree, so its real call cost is zero.",
  ),
  limited(
    "reel-editor",
    STATIC,
    { max: 120, file: "lib/mcp/tools-edit.ts", line: 13, note: "media saves use the shared 120/min edit budget; uploads cap at 100 MiB (lib/host/fs-upload.ts:13)" },
    "Decodes and re-encodes media locally, then writes it back through the bounded upload path.",
  ),
  idle(
    "shell-settings",
    STATIC,
    "Shared settings UI primitives: no fetch, /api call or host operation in this slice's tree; it owns no data path of its own.",
  ),
  limited(
    "system-monitor",
    poll(1_500, "frontend/slices/system-monitor/lib/use-stats-history.ts", 8),
    { max: 30, file: "lib/host/sys-services-service.ts", line: 14, note: "sys-services-list limiter: 30 requests per 60 s per actor" },
    "Polls host telemetry every 1500 ms; service inventory and logs share the host limiter rather than inventing a second one.",
  ),
  limited(
    "workflows",
    STATIC,
    { max: 30, file: "lib/mcp/tools-workflow-lifecycle.ts", line: 43, note: "workflow.status limiter: 30 per 60 s" },
    "Polls run status every 1600 ms while a run is active (app.tsx:51) and can start a run, which reaches the capability kernel.",
  ),
];
