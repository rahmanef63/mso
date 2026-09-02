import { runReadPipeline } from "./read-pipeline-engine";
import type { ReadPipelineCall } from "./read-pipeline-types";
import { type McpTool, S } from "./tool-kit";

const TRANSFORM = {
  type: "object",
  properties: {
    path: { type: "string", description: "Optional simple dotted path selected from the raw result before other operations." },
    where: { type: "array", maxItems: 4, items: { type: "object", properties: {
      field: { type: "string" }, op: { type: "string", enum: ["eq", "ne", "contains", "gt", "gte", "lt", "lte", "exists"] }, value: {},
    }, required: ["field", "op"], additionalProperties: false } },
    select: { type: "array", maxItems: 12, items: { type: "string" } },
    sort: { type: "object", properties: { field: { type: "string" }, direction: { type: "string", enum: ["asc", "desc"] } }, required: ["field"], additionalProperties: false },
    uniqueBy: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 },
    aggregate: { type: "object", properties: { op: { type: "string", enum: ["count", "sum", "avg", "min", "max"] }, field: { type: "string" } }, required: ["op"], additionalProperties: false },
  },
  additionalProperties: false,
} as const;

export const READ_PIPELINE_TOOLS: McpTool[] = [{
  name: "read_pipeline",
  description:
    "Execute 1-6 independent READ-ONLY MSO tool calls server-side, then deterministically filter/project/sort/unique/limit/aggregate their results before returning them to the model. " +
    "Use this when several reads can be batched or raw lists/log metadata would waste context. It cannot call write/exec tools, workflow_status, screenshots, wait/poll tools, arbitrary code, shell, or nested pipelines. Child calls inherit this session/workflow and retain their own rate limits.",
  scope: "read",
  annotations: { readOnlyHint: true, idempotentHint: true },
  limit: { key: "read.pipeline", max: 30, windowMs: 60_000 },
  result: { maxTextBytes: 48 * 1024, overflowHint: "Pipeline output was compacted; add path/select/filter/aggregate or lower per-call limit." },
  inputSchema: S({
    calls: { type: "array", minItems: 1, maxItems: 6, description: "Independent read calls. Child workflow_id is forbidden; the parent workflow is inherited.", items: {
      type: "object", properties: {
        id: { type: "string", description: "Unique simple id used as the result key." },
        tool: { type: "string", description: "Exact eligible read-only MSO tool name." },
        arguments: { type: "object", additionalProperties: true }, transform: TRANSFORM,
      }, required: ["id", "tool"], additionalProperties: false,
    } },
    mode: { type: "string", enum: ["parallel", "sequential"], description: "parallel by default; output order remains declaration order." },
    continueOnError: { type: "boolean", description: "Default false. When true, failed child reads become bounded error rows while other calls continue." },
  }, ["calls"]),
  run: async (a, context) => {
    const { TOOLS_BY_NAME } = await import("./tools");
    return runReadPipeline({
      calls: a.calls as ReadPipelineCall[],
      mode: a.mode === "sequential" ? "sequential" : "parallel",
      continueOnError: a.continueOnError === true,
    }, context, (name) => TOOLS_BY_NAME.get(name));
  },
}];
