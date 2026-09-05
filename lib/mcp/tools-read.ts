import { ownedArtifactSession } from "@/lib/agent/artifact-session";
import { saveSessionArtifact } from "@/lib/agent/artifacts";
import { artifactPaths } from "@/lib/agent/artifact-paths";
import path from "node:path";
import { listDir, readFile, searchFs, usage, sha256Text, utf8Bytes } from "@/lib/host/fs-api";
import { stats, processes } from "@/lib/host/system-api";
import { captureMsoScreen } from "@/lib/host/screenshot-api";
import { createTempShare, tempShareUrl } from "@/lib/host/temp-share-api";
import { camoufoxStatus } from "@/lib/camoufox/service";
import { listManagedApps, getManagedAppLogs } from "@/lib/managed-apps/manager";
import { searchSkillMemory } from "@/lib/skills/search";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { type McpTool, str, opt, S, PATH_P, READ_ONLY, mcpDirect } from "./tool-kit";

// The read tier: observability with no way to change anything. Everything here is
// answerable without granting a shell, which is the whole point of the tiering —
// "why is hermes down?" should not cost the same trust as `exec_run`.
export const READ_TOOLS: McpTool[] = [
  {
    name: "fs_list",
    description:
      "List a directory on the VPS. Returns entries with name and type. Size is reported as 0 for " +
      "every entry and is NOT a real size — never conclude a file is empty from it. " +
      "USE THIS FIRST to discover paths before reading or writing — guessing a path wastes a call. " +
      "Reads are bounded to OS_FS_READ_ROOTS and credential paths (~/.ssh, ~/.mso, cloud tokens) are refused.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({ ...PATH_P, includeHidden: { type: "boolean", description: "Include dotfiles. Default true." } }, ["path"]),
    run: (a) => listDir(str(a, "path"), a.includeHidden !== false),
  },
  {
    name: "fs_read",
    description:
      "Read a text file on the VPS and return its contents plus UTF-8 byte count and SHA-256. " +
      "Use that hash as fs_write.expected_sha256 to avoid overwriting a file changed since inspection. For binary files this will be garbage — " +
      "check the extension from fs_list first. NOT for finding a file: use fs_search.",
    scope: "read",
    annotations: READ_ONLY,
    result: { maxTextBytes: 64 * 1024, overflowHint: "Read a narrower file/range through a project-specific function or inspect only the relevant section." },
    inputSchema: S(PATH_P, ["path"]),
    run: async (a) => {
      const content = await readFile(str(a, "path"));
      return { path: a.path, content, bytes: utf8Bytes(content), sha256: sha256Text(content) };
    },
  },
  {
    name: "fs_search",
    description:
      "Find DIRECTORIES whose name contains a fragment, recursively, under a root. Use it to locate a " +
      "project folder before fs_list — it is bounded and needs no shell scope, unlike exec_run with find. " +
      "It does NOT match file names or file contents; fs_list the directory it returns.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({
      query: { type: "string", description: "Substring matched against directory names." },
      root: { type: "string", description: "Where to search from. Defaults to ~/projects." },
    }, ["query"]),
    run: (a) => searchFs(str(a, "query"), { root: opt(a, "root") }),
  },
  {
    name: "fs_usage",
    description: "Disk usage for a path: total, used and free bytes. Use for 'is the VPS full?'.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S(PATH_P, ["path"]),
    run: (a) => usage(str(a, "path")),
  },
  {
    name: "sys_stats",
    description:
      "Live VPS health: CPU load, memory, disk and uptime. Uptime is returned with explicit units as uptimeMs and uptimeSeconds — never interpret either as days. " +
      "USE THIS for 'how is the server doing'; it is one cheap call and needs no shell scope.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({}),
    run: async () => {
      const { uptime, ...health } = await stats();
      return { ...health, uptimeMs: Math.round(uptime), uptimeSeconds: Math.round(uptime / 1000) };
    },
  },
  {
    name: "sys_processes",
    description: "Top processes by CPU with pid, command, cpu% and memory%. Use to find what is eating the box.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({}),
    run: () => processes(),
  },
  {
    name: "apps_list",
    description:
      "List the managed applications mso can install and control on this VPS, with install and running state. " +
      "This is NOT the mso app list (Files, Terminal, …) — those are UI surfaces with no server state.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({}),
    // `{ apps: [...] }`, not a bare array — GET /api/v1/managed-apps is the authority
    // on this shape and `mso mapp list` already prints its envelope. Returning the
    // array raw meant one capability answered in two shapes depending on which
    // surface asked, which is exactly the drift the parity gate exists to stop.
    run: async () => ({ apps: await listManagedApps() }),
  },
  {
    name: "apps_logs",
    description:
      "Recent log output for a managed application (hermes, openclaw). USE THIS to answer 'why is X " +
      "down' — it needs only read scope, where the same question via exec_run would need a full shell. " +
      "Call apps_list first for the valid ids and their state.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({ id: { type: "string", description: "Managed app id from apps_list, e.g. hermes." } }, ["id"]),
    run: (a) => {
      const id = str(a, "id");
      if (!isManagedAppId(id)) throw new Error(`unknown managed application "${id}" — call apps_list for valid ids`);
      return getManagedAppLogs(id);
    },
  },
  {
    name: "skills_search",
    description:
      "Semantic search across trusted SKILL.md files, the live MCP tool catalog and learned successful workflows. " +
      "Use this alone for capability research or unfamiliar single-step work. For a multi-step task call workflow_start directly — it already performs this search and avoids a duplicate startup call. " +
      "The embedding runs locally with no API cost; untrusted skill instructions are excluded unless explicitly requested.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({
      query: { type: "string", description: "The user's task or capability question in one complete sentence." },
      top_k: { type: "number", minimum: 1, maximum: 20, description: "Maximum matches. Default 8." },
      include_untrusted: { type: "boolean", description: "Include metadata-only matches from untrusted skill roots. Default false." },
    }, ["query"]),
    run: async (a, context) => {
      const { TOOLS } = await import("./tools");
      return searchSkillMemory(str(a, "query"), {
        ...(context.actor ? { recipeAccess: { actor: context.actor, scope: context.scope } } : {}),
        topK: typeof a.top_k === "number" ? a.top_k : undefined,
        includeUntrusted: a.include_untrusted === true,
        toolDocs: TOOLS.map((t) => ({ name: t.name, description: t.description, scope: t.scope, inputSchema: t.inputSchema })),
      });
    },
  },
  {
    name: "screen_capture",
    description:
      "Capture the authenticated MSO desktop and return it as an image. This is intentionally limited to " +
      "MSO itself (no arbitrary URL capture), so it can be used to show visual progress without turning a read token " +
      "into a browser exfiltration primitive. It saves a session-scoped artifact when a durable session exists, plus a 15-minute authenticated preview/download link. " +
      "Choose macos, windows or dashboard; default macos.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "screen.capture", max: 10, windowMs: 60_000 },
    inputSchema: S({
      shell: { type: "string", enum: ["macos", "windows", "dashboard"], description: "Desktop shell to render. Default macos." },
      width: { type: "number", minimum: 900, maximum: 1920, description: "Viewport width. Default 1440." },
      height: { type: "number", minimum: 600, maximum: 1200, description: "Viewport height. Default 900." },
    }),
    run: async (a, context) => {
      const shell = typeof a.shell === "string" && ["macos", "windows", "dashboard"].includes(a.shell)
        ? (a.shell as "macos" | "windows" | "dashboard")
        : "macos";
      const shot = await captureMsoScreen({
        shell,
        width: typeof a.width === "number" ? a.width : undefined,
        height: typeof a.height === "number" ? a.height : undefined,
      });
      const owner = context.principal && context.sessionId ? await ownedArtifactSession(context.principal,context.sessionId) : null;
      const artifact = owner ? await saveSessionArtifact(owner,Buffer.from(shot.data,"base64"),{project:"mso",feature:`shell-${shell}`,environment:"local",width:shot.width,height:shot.height,producer:"mso",workflowId:context.workflowId}) : null;
      const artifactPath = owner && artifact ? path.join(artifactPaths(owner).directory,artifact.relativePath) : undefined;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const share = await createTempShare({
        data: Buffer.from(shot.data, "base64"),
        filename: `mso-${shot.shell}-${stamp}.png`,
        mimeType: shot.mimeType,
        ttlMs: 15 * 60_000,
        maxDownloads: 5,
      });
      const previewUrl = tempShareUrl(share.id);
      const downloadUrl = tempShareUrl(share.id, true);
      return mcpDirect([
        { type: "image", data: shot.data, mimeType: shot.mimeType },
        {
          type: "text",
          text:
            `MSO ${shot.shell} screenshot — ${shot.width}×${shot.height}\n` +
            (artifactPath ? `Session artifact: ${artifactPath}\n` : "") +
            `Temporary preview: ${previewUrl}\n` +
            `Direct download: ${downloadUrl}\n` +
            `Expires ${new Date(share.expiresAt).toISOString()} · ${share.downloadsLeft} authenticated downloads`,
        },
      ], false, {
        result: { artifact, artifactPath, shell: shot.shell, width: shot.width, height: shot.height, mimeType: shot.mimeType, previewUrl, downloadUrl, expiresAt: share.expiresAt, downloadsLeft: share.downloadsLeft },
      });
    },
  },
  {
    name: "browser_status",
    description:
      "State of the Camoufox anti-fingerprinting browser (a real Firefox on a headless display). " +
      "Returns installed/running/autostart only. The viewer URL and its one-time VNC password are DELIBERATELY not " +
      "returned here — that session holds live Google and LinkedIn logins, so its credentials never leave " +
      "the box through a tool result. Open Settings in mso to get them.",
    scope: "read",
    annotations: READ_ONLY,
    inputSchema: S({}),
    run: async () => {
      const s = await camoufoxStatus();
      return { installed: s.installed, running: s.running, autostart: s.enabled };
    },
  },
];
