import type { McpRunContext, McpTool } from "./tool-kit";
import { isMcpDirectResult } from "./tool-kit";
import { toolRateLimited } from "./tool-rate-limit";
import { transformReadResult, validPipelineId } from "./read-pipeline-transform";
import {
  READ_PIPELINE_MAX_CALLS,
  READ_PIPELINE_OUTPUT_STEP_BYTES,
  READ_PIPELINE_OUTPUT_TOTAL_BYTES,
  READ_PIPELINE_RAW_STEP_BYTES,
  READ_PIPELINE_WALL_MS,
  type ReadPipelineCall,
  type ReadPipelineEvidence,
  type ReadPipelineInput,
} from "./read-pipeline-types";

const EXCLUDED = new Set(["read_pipeline", "workflow_status", "screen_capture", "session_artifacts", "local_agent_request_wait"]);

function jsonBytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
  catch { throw new Error("read tool returned a non-serializable result"); }
}

function boundedValue(value: unknown, maxBytes = READ_PIPELINE_OUTPUT_STEP_BYTES): unknown {
  const bytes = jsonBytes(value); if (bytes <= maxBytes) return value;
  if (Array.isArray(value)) {
    let low = 0, high = value.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = { msoPipelineTruncated: true, totalItems: value.length, returnedItems: mid, items: value.slice(0, mid) };
      if (jsonBytes(candidate) <= maxBytes) low = mid; else high = mid - 1;
    }
    return { msoPipelineTruncated: true, totalItems: value.length, returnedItems: low, items: value.slice(0, low) };
  }
  let raw: string; try { raw = JSON.stringify(value); } catch { raw = String(value); }
  const preview = raw.slice(0, Math.max(512, Math.floor(maxBytes / 2)));
  return { msoPipelineTruncated: true, originalBytes: bytes, preview };
}

function validateCalls(calls: ReadPipelineCall[]): void {
  if (!Array.isArray(calls) || calls.length < 1 || calls.length > READ_PIPELINE_MAX_CALLS) throw new Error(`calls must contain 1-${READ_PIPELINE_MAX_CALLS} entries`);
  const ids = new Set<string>();
  for (const call of calls) {
    if (!call || typeof call !== "object" || !validPipelineId(call.id)) throw new Error("each call.id must be a simple unique identifier");
    if (ids.has(call.id)) throw new Error(`duplicate call.id: ${call.id}`); ids.add(call.id);
    if (typeof call.tool !== "string" || !call.tool) throw new Error(`${call.id}: tool is required`);
    if (call.arguments !== undefined && (!call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments))) throw new Error(`${call.id}: arguments must be an object`);
    if (Object.prototype.hasOwnProperty.call(call.arguments ?? {}, "workflow_id")) throw new Error(`${call.id}: child workflow_id is forbidden; the pipeline inherits the parent workflow`);
  }
}

function readTool(tool: McpTool | undefined, name: string): McpTool {
  if (!tool || tool.scope !== "read" || tool.annotations?.readOnlyHint !== true || EXCLUDED.has(name)) {
    throw new Error(`${name}: read_pipeline can invoke only eligible read-only tools`);
  }
  return tool;
}


async function beforeDeadline<T>(promise: Promise<T>, deadlineAt: number): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error(`read_pipeline exceeded its ${READ_PIPELINE_WALL_MS}ms wall-time budget`);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`read_pipeline exceeded its ${READ_PIPELINE_WALL_MS}ms wall-time budget`)), remaining);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function validateRequired(tool: McpTool, args: Record<string, unknown>): void {
  for (const key of tool.inputSchema.required ?? []) if (args[key] == null) throw new Error(`${tool.name} needs { ${(tool.inputSchema.required ?? []).join(", ")} }`);
}

export async function runReadPipeline(
  input: ReadPipelineInput,
  context: McpRunContext,
  resolveTool: (name: string) => McpTool | undefined,
  wallMs = READ_PIPELINE_WALL_MS,
): Promise<{ ok: boolean; mode: string; results: Record<string, unknown>; evidence: ReadPipelineEvidence[]; metrics: Record<string, number> }> {
  validateCalls(input.calls);
  const started = Date.now(), deadlineAt = started + Math.max(1, Math.min(READ_PIPELINE_WALL_MS, wallMs));

  const one = async (call: ReadPipelineCall): Promise<{
    id: string; result: unknown; evidence: ReadPipelineEvidence; rawBytes: number; outputBytes: number;
  }> => {
    const stepStarted = Date.now(), args = { ...(call.arguments ?? {}) };
    try {
      const tool = readTool(resolveTool(call.tool), call.tool);
      validateRequired(tool, args);
      if (toolRateLimited(tool, args, context.actor)) throw new Error(`${tool.name} is rate limited`);
      const raw = await beforeDeadline(tool.run(args, { ...context, scope: "read" }), deadlineAt);
      if (isMcpDirectResult(raw)) throw new Error(`${tool.name}: direct image/file results are not pipeline-compatible`);
      const rawBytes = jsonBytes(raw);
      if (rawBytes > READ_PIPELINE_RAW_STEP_BYTES) throw new Error(`${tool.name}: raw result exceeds ${READ_PIPELINE_RAW_STEP_BYTES} bytes; narrow the read first`);
      const transformed = transformReadResult(raw, call.transform), bounded = boundedValue(transformed);
      const outputBytes = jsonBytes(bounded);
      return {
        id: call.id, result: bounded, rawBytes, outputBytes,
        evidence: { id: call.id, tool: tool.name, ok: true, durationMs: Date.now() - stepStarted, rawBytes, outputBytes,
          reductionPct: rawBytes ? Math.round((1 - outputBytes / rawBytes) * 1000) / 10 : 0 },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!input.continueOnError) throw error;
      return {
        id: call.id, result: { error: message.slice(0, 300) }, rawBytes: 0, outputBytes: 0,
        evidence: { id: call.id, tool: call.tool, ok: false, durationMs: Date.now() - stepStarted, error: message.slice(0, 300) },
      };
    }
  };

  const rows: Awaited<ReturnType<typeof one>>[] = [];
  if (input.mode === "sequential") for (const call of input.calls) rows.push(await one(call));
  else rows.push(...await Promise.all(input.calls.map(one)));

  const results: Record<string, unknown> = {};
  let rawBytesTotal = 0, outputBytesTotal = 0;
  for (const row of rows) {
    results[row.id] = row.result; rawBytesTotal += row.rawBytes; outputBytesTotal += row.outputBytes;
  }
  const compactResults = boundedValue(results, READ_PIPELINE_OUTPUT_TOTAL_BYTES) as Record<string, unknown>;
  const finalOutputBytes = jsonBytes(compactResults), evidence = rows.map((row) => row.evidence);
  return {
    ok: evidence.every((row) => row.ok), mode: input.mode === "sequential" ? "sequential" : "parallel",
    results: compactResults, evidence,
    metrics: {
      callCount: input.calls.length, rawBytes: rawBytesTotal, transformedBytes: outputBytesTotal, returnedBytes: finalOutputBytes,
      reductionPct: rawBytesTotal ? Math.round((1 - finalOutputBytes / rawBytesTotal) * 1000) / 10 : 0,
      elapsedMs: Date.now() - started,
    },
  };
}
