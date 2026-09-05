import { appendAgentSessionEvent } from "@/lib/agent/session-store";
import { listSessionArtifacts, readSessionArtifact, registerIncomingArtifact } from "@/lib/agent/artifacts";
import { ownedArtifactSession } from "@/lib/agent/artifact-session";
import { cleanupSessionArtifacts } from "@/lib/agent/artifact-cleanup";
import type { ArtifactInput } from "@/lib/agent/artifact-types";
import { mcpDirect, S, opt, str, type McpTool } from "./tool-kit";

const FILE = {
  type: "object",
  additionalProperties: false,
  required: ["source", "feature"],
  properties: {
    source: { type: "string", maxLength: 180, description: "One staged basename in MSO_SCREENSHOT_DIR; never an absolute path." },
    feature: { type: "string", maxLength: 80 },
    locale: { type: "string", maxLength: 24 },
    width: { type: "integer", minimum: 1, maximum: 20000 },
    height: { type: "integer", minimum: 1, maximum: 20000 },
    url: { type: "string", maxLength: 2048, description: "Optional captured page; credentials, query and fragment are discarded." },
  },
};
export const SESSION_ARTIFACT_TOOLS: McpTool[] = [
  {
    name: "session_artifacts",
    scope: "read",
    description:
      "List this session's private screenshots/reports, or read one artifact_id as an image/JSON. Returns exact dynamic paths, checksum and retention; optional session_id must belong to the same authenticated client. No public URL is created.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    limit: { key: "session.artifacts", max: 60, windowMs: 60000 },
    inputSchema: S({
      session_id: { type: "string" },
      artifact_id: { type: "string" },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }),
    run: async (a, context) => {
      const owner = await ownedArtifactSession(context.principal, opt(a, "session_id") || context.sessionId);
      if (!a.artifact_id) return listSessionArtifacts(owner, Number(a.offset) || 0, Number(a.limit) || 50);
      const artifact = await readSessionArtifact(owner, str(a, "artifact_id"));
      const metadata = { ...artifact.entry, path: artifact.path, sessionId: owner.id };
      if (artifact.entry.kind === "report")
        return { artifact: metadata, text: artifact.bytes.toString("utf8").slice(0, 32000), truncated: artifact.bytes.length > 32000 };
      let bytes = artifact.bytes,
        mimeType = artifact.entry.mimeType;
      if (bytes.length > 620 * 1024) {
        const sharp = (await import("sharp")).default;
        bytes = await sharp(bytes, { limitInputPixels: 40000000 })
          .resize({ width: 1440, height: 1600, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 72 })
          .toBuffer();
        mimeType = "image/jpeg";
      }
      if (bytes.length > 620 * 1024)
        throw new Error("Image preview remains too large; inspect the saved original using the owner terminal");
      return mcpDirect(
        [
          { type: "image", data: bytes.toString("base64"), mimeType },
          { type: "text", text: JSON.stringify(metadata) },
        ],
        false,
        { result: { artifact: metadata, previewMimeType: mimeType } },
      );
    },
  },
  {
    name: "session_artifact_register",
    scope: "write",
    description:
      "Register 1-40 Playwright/Camoufox screenshots or JSON reports from this session's MSO_SCREENSHOT_DIR. Use umask 077 when producing files. Assigns descriptive project/feature/locale/viewport/time names, hashes and one session manifest; raw producer files remain until retention cleanup.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    audit: { action: "agent.session", targetArg: "project" },
    limit: { key: "session.artifact.register", max: 30, windowMs: 60000 },
    inputSchema: S(
      {
        project: { type: "string", maxLength: 80 },
        environment: { type: "string", maxLength: 32 },
        producer: { type: "string", enum: ["playwright", "camoufox", "mso", "other"] },
        files: { type: "array", minItems: 1, maxItems: 40, items: FILE },
      },
      ["project", "files"],
    ),
    run: async (a, context) => {
      const owner = await ownedArtifactSession(context.principal, context.sessionId);
      if (!Array.isArray(a.files) || a.files.length < 1 || a.files.length > 40)
        throw new Error("files must contain 1-40 artifact descriptors");
      const results = [];
      for (const value of a.files) {
        const row = value as ArtifactInput & { source: string };
        if (!row || typeof row !== "object") throw new Error("invalid artifact descriptor");
        try {
          const artifact = await registerIncomingArtifact(owner, row.source, {
            ...row,
            project: str(a, "project"),
            environment: opt(a, "environment"),
            producer: opt(a, "producer") as ArtifactInput["producer"],
            workflowId: context.workflowId,
          });
          results.push({ ok: true, artifact });
        } catch (error) {
          results.push({
            ok: false,
            source: typeof row.source === "string" ? row.source.slice(0, 180) : "invalid",
            error: error instanceof Error ? error.message : "artifact registration failed",
          });
        }
      }
      const saved = results.filter((r) => r.ok).length;
      await appendAgentSessionEvent(context.principal!, owner.id, {
        kind: "note",
        workflowId: context.workflowId,
        detail: `Artifacts: ${saved}/${results.length} saved; use session_artifacts for names and paths.`,
      });
      return { sessionId: owner.id, saved, results };
    },
  },
  {
    name: "session_artifacts_cleanup",
    scope: "write",
    description:
      "Preview or remove expired dormant artifact folders owned by this client. Dry-run defaults true. Current session, recent/leased sessions, unknown files, symlinks and unsafe permissions are preserved; durable session records are never removed.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    audit: { action: "agent.session" },
    limit: { key: "session.artifact.cleanup", max: 6, windowMs: 60000 },
    inputSchema: S({ dry_run: { type: "boolean", description: "Default true: inspect only; false applies bounded retention cleanup." } }),
    run: async (a, context) => {
      await ownedArtifactSession(context.principal, context.sessionId);
      return cleanupSessionArtifacts({ principal: context.principal, currentSessionId: context.sessionId, dryRun: a.dry_run !== false });
    },
  },
];
