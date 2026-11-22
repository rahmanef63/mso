import type { SliceBudgetEntry } from "./types";
import { STATIC, withWorker } from "./profiles";
import { bounded, limited } from "./registry-entry";

/**
 * The registry: one entry per Svelte 5 feature module under frontend/svelte/src/lib.
 */
export const REGISTRY: readonly SliceBudgetEntry[] = [
  limited(
    "agent-group",
    withWorker(STATIC, "lib/agent-group/hermes-runner.ts", 57),
    { max: 30, file: "lib/agent-group/http.ts", line: 45, note: "agent-groups limiter: 30 per 60 s for action=run, 60 per 60 s otherwise, per device" },
    "Runs several Hermes profiles per discussion under a 30/min run limiter.",
  ),
  limited(
    "agent-vault",
    STATIC,
    { max: 60, file: "lib/mcp/tools-agent-vault.ts", line: 9, note: "agent.vault.read limiter: 60 per 60 s; sync is 10/min at line 19" },
    "Reads and syncs the private progress vault through bounded fs and memory-graph routes.",
  ),
  limited(
    "assistant",
    withWorker(STATIC, "lib/agent/host-tools/catalog-mutate.ts", 150),
    { max: 120, file: "app/mcp/handler.ts", line: 22, note: "CALLS_PER_MIN = 120 per MCP token per minute" },
    "Streams assistant turns, reads MCP activity, and runs approved host commands.",
  ),
  limited(
    "auth",
    STATIC,
    { max: 30, file: "app/api/auth/login/handler.ts", line: 25, note: "GLOBAL_MAX_ATTEMPTS = 30 login attempts per 60 s window" },
    "Handles session verification and login under the dedicated login rate limiter.",
  ),
  limited(
    "catalog",
    STATIC,
    { max: 120, file: "lib/mcp/tools-project-mcp-manage.ts", line: 11, note: "project.mcp.manage: 20 per 60 s, with inspect override of 120 per 60 s" },
    "App Store and Extensions catalog for MCP servers, skills, and shell apps.",
  ),
  limited(
    "create-app",
    STATIC,
    { max: 20, file: "lib/surfaces/shell-apps-service.ts", line: 28, note: "shell-app limiter: 20 per 60 s per device" },
    "Authors and registers custom MSO shell app manifests.",
  ),
  limited(
    "creative",
    STATIC,
    { max: 120, file: "lib/mcp/tools-edit.ts", line: 13, note: "fs.edit limiter: 120 per 60 s" },
    "Image Editor, Media Studio, and Reel Editor persist edits through bounded fs writes.",
  ),
  limited(
    "docs",
    STATIC,
    { max: 120, file: "lib/mcp/tools-edit.ts", line: 13, note: "bounded fs read limiter: 120 per 60 s" },
    "In-app documentation viewer reading bounded docs from the host.",
  ),
  limited(
    "editor",
    STATIC,
    { max: 120, file: "lib/mcp/tools-edit.ts", line: 13, note: "fs.edit limiter: 120 edits per 60 s" },
    "Code and text editor reading and saving files under the 120/min fs edit limiter.",
  ),
  limited(
    "files",
    STATIC,
    { max: 120, file: "lib/mcp/tools-edit.ts", line: 13, note: "fs.edit limiter: 120 edits per 60 s" },
    "Reads and mutates the host filesystem through /api/v1/fs.",
  ),
  limited(
    "infra",
    STATIC,
    { max: 20, file: "lib/mcp/tools-infra.ts", line: 58, note: "infra.dokploy 20/min, Cloudflare 20 (line 86), Hostinger 10 (line 96)" },
    "Provider inventory reads and DNS/ingress writes under the 20/min infra limiter.",
  ),
  limited(
    "integrations",
    STATIC,
    { max: 30, file: "lib/mcp/tools-integrations.ts", line: 23, note: "integration.execute limiter: 30 per 60 s" },
    "Integrations and Channels workspace bounded by the 30/min integration execute limiter.",
  ),
  limited(
    "managed-apps",
    STATIC,
    { max: 12, file: "lib/mcp/tools-power.ts", line: 13, note: "managed-app limiter: 12 per 60 s per app id" },
    "AppDeck managed OSS app lifecycle, preflight, backup, and update behind the 12/min limiter.",
  ),
  bounded(
    "media",
    { file: "app/api/v1/fs/raw/handler.ts", line: 10, note: "no request-rate limiter; bounded by 4 concurrent raw streams per actor, 16 globally" },
    "Streams media bytes with Range requests and icon/image pickers.",
  ),
  bounded(
    "memory-graph",
    { file: "lib/memory-graph/vault.ts", line: 10, note: "no request-rate limiter; bounded by 160 files per graph build" },
    "Builds one bounded knowledge graph per request (160 files, depth 6).",
  ),
  limited(
    "monitor",
    STATIC,
    { max: 30, file: "lib/host/sys-services-service.ts", line: 14, note: "sys-services-list limiter: 30 requests per 60 s per actor" },
    "System monitor, processes, services, and packages telemetry.",
  ),
  limited(
    "organization",
    STATIC,
    { max: 40, file: "lib/agent/organization-service.ts", line: 72, note: "organization limiter: 40 per 60 s per device" },
    "Owner-private organization chart mutations at 40/min.",
  ),
  limited(
    "runtime-apps",
    STATIC,
    { max: 12, file: "lib/camoufox/http.ts", line: 36, note: "camoufox limiter: 12 per 60 s; desktop lifecycle 12/min" },
    "Camoufox Browser, Bot Desktops, and reviewed n8n workspace runtimes.",
  ),
  limited(
    "settings",
    STATIC,
    { max: 6, file: "lib/host/sys-update-service.ts", line: 26, note: "sys-update-check limiter: 6 checks per 60 s" },
    "Settings, preferences, audit log, and Software Update behind the 6/min update limiter.",
  ),
  limited(
    "shell",
    STATIC,
    { max: 20, file: "lib/surfaces/shell-apps-service.ts", line: 28, note: "shell-app limiter: 20 per 60 s per device" },
    "Desktop/mobile window manager, dock, command palette, lock screen, and notifications.",
  ),
  limited(
    "terminal",
    withWorker(STATIC, "lib/host/pty.ts", 22),
    { max: 20, file: "lib/host/term-service.ts", line: 16, note: "OPEN_MAX = 20 shell opens per 60 s per actor" },
    "Opens real PTYs (8 live shells max) inside a 20/min open limiter.",
  ),
  limited(
    "workflows",
    STATIC,
    { max: 30, file: "lib/mcp/tools-workflow-lifecycle.ts", line: 43, note: "workflow.status limiter: 30 per 60 s" },
    "Native SVG workflow graph editor, triggers, and run lifecycle.",
  ),
];
