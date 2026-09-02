export const READ_PIPELINE_MAX_CALLS = 6;
export const READ_PIPELINE_MAX_FILTERS = 4;
export const READ_PIPELINE_MAX_SELECT = 12;
export const READ_PIPELINE_MAX_LIMIT = 100;
export const READ_PIPELINE_RAW_STEP_BYTES = 1024 * 1024;
export const READ_PIPELINE_OUTPUT_STEP_BYTES = 12 * 1024;
export const READ_PIPELINE_OUTPUT_TOTAL_BYTES = 40 * 1024;
export const READ_PIPELINE_WALL_MS = 15_000;

export type ReadPipelineOperator = "eq" | "ne" | "contains" | "gt" | "gte" | "lt" | "lte" | "exists";
export type ReadPipelineAggregate = "count" | "sum" | "avg" | "min" | "max";

export type ReadPipelineFilter = {
  field: string;
  op: ReadPipelineOperator;
  value?: string | number | boolean | null;
};

export type ReadPipelineTransform = {
  path?: string;
  where?: ReadPipelineFilter[];
  select?: string[];
  sort?: { field: string; direction?: "asc" | "desc" };
  uniqueBy?: string;
  limit?: number;
  aggregate?: { op: ReadPipelineAggregate; field?: string };
};

export type ReadPipelineCall = {
  id: string;
  tool: string;
  arguments?: Record<string, unknown>;
  transform?: ReadPipelineTransform;
};

export type ReadPipelineInput = {
  calls: ReadPipelineCall[];
  mode?: "parallel" | "sequential";
  continueOnError?: boolean;
};

export type ReadPipelineEvidence = {
  id: string;
  tool: string;
  ok: boolean;
  durationMs: number;
  rawBytes?: number;
  outputBytes?: number;
  reductionPct?: number;
  error?: string;
};
