import { assertDelegatedWritePath } from "@/lib/host/fs-api";
import { editFileGuarded } from "@/lib/host/fs-edit";
import { type McpTool, opt, PATH_P, S, str } from "./tool-kit";
import { requireWorkflowMutationPath } from "./workflow-workspace-guard";

async function requireDelegatedPath(context: Parameters<McpTool["run"]>[1], target: string) {
  if (context.scope !== "exec") await assertDelegatedWritePath(target);
}

export const EDIT_TOOLS: McpTool[] = [
  {
    name: "fs_edit",
    limit: { key: "fs.edit", max: 120, windowMs: 60_000 },
    audit: { action: "fs.write" as const, targetArg: "path" },
    description: "Edit a file by replacing exact old_string occurrences with new_string. Fails on zero matches or on multiple matches unless replace_all is true. Read first, pass its SHA-256 as expected_sha256 to refuse stale edits. Bounded to OS_FS_WRITE_ROOTS.",
    scope: "write",
    annotations: { idempotentHint: true },
    actionContract: { phase: "mutate", target: "filesystem-text", sourceOfTruth: "live", discover: ["fs_read"], validators: ["path-policy", "sha256-cas"], verify: ["fs_read"], confirmation: "contextual", concurrency: "hash", presentation: "structured" },
    inputSchema: S({
      ...PATH_P,
      old_string: { type: "string", description: "Exact text to find and replace. Must not be empty." },
      new_string: { type: "string", description: "Replacement text." },
      replace_all: { type: "boolean", description: "Replace all occurrences when true. Default false requires exactly one match." },
      expected_sha256: { type: "string", description: "Optional SHA-256 returned by fs_read; refuse if the current file no longer matches." },
    }, ["path", "old_string", "new_string"]),
    run: async (a, context) => {
      const target = str(a, "path");
      await requireWorkflowMutationPath(context, target);
      await requireDelegatedPath(context, target);
      return editFileGuarded({
        path: target,
        oldString: typeof a.old_string === "string" ? a.old_string : str(a, "old_string"),
        newString: typeof a.new_string === "string" ? a.new_string : "",
        replaceAll: a.replace_all === true,
        expectedSha256: opt(a, "expected_sha256"),
      });
    },
  },
];
