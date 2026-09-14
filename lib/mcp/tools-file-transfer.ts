import { createHash } from "node:crypto";
import path from "node:path";
import { mimeFor, readFileBytes } from "@/lib/host/fs-api";
import { createTempShare, tempShareUrl } from "@/lib/host/temp-share-api";
import { createMcpFileResource } from "./file-transfer-resource";
import { mcpDirect, PATH_P, READ_ONLY, S, str, type McpTool } from "./tool-kit";

export const FILE_TRANSFER_READ_TOOLS: McpTool[] = [
  {
    name: "fs_export_file",
    description:
      "Export one original VPS file (max 10 MiB) from OS_FS_READ_ROOTS. Returns an owner-bound 15-minute MCP binary resource plus an approved-device browser download; bytes are never decoded or recompressed.",
    scope: "read",
    annotations: READ_ONLY,
    limit: { key: "fs.export", max: 20, windowMs: 60_000 },
    inputSchema: S(PATH_P, ["path"]),
    run: async (a, context) => {
      if (!context.principal || !context.sessionId) throw new Error("authenticated MCP principal and session required");
      const requested = str(a, "path");
      const bytes = await readFileBytes(requested, 10 * 1024 * 1024);
      const filename = path.basename(requested), mimeType = mimeFor(requested);
      const resource = await createMcpFileResource({
        data: bytes, filename, mimeType, principal: context.principal, sessionId: context.sessionId, ttlMs: 15 * 60_000, maxReads: 5,
      });
      const share = await createTempShare({ data: bytes, filename, mimeType, ttlMs: 15 * 60_000, maxDownloads: 5 });
      const result = {
        path: requested, filename, mimeType, bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        resourceUri: resource.uri,
        resourceExpiresAt: resource.expiresAt,
        resourceReadsLeft: resource.readsLeft,
        browserPreviewUrl: tempShareUrl(share.id),
        browserDownloadUrl: tempShareUrl(share.id, true),
        browserExpiresAt: share.expiresAt,
        browserDownloadsLeft: share.downloadsLeft,
      };
      return mcpDirect([
        {
          type: "resource_link", uri: resource.uri, name: filename,
          description: "Owner-bound MCP original bytes. Read with resources/read before expiry.", mimeType,
        },
        { type: "text", text: JSON.stringify(result) },
      ], false, { result });
    },
  },
];
