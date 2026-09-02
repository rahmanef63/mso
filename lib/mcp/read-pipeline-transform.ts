import {
  READ_PIPELINE_MAX_FILTERS,
  READ_PIPELINE_MAX_LIMIT,
  READ_PIPELINE_MAX_SELECT,
  type ReadPipelineFilter,
  type ReadPipelineTransform,
} from "./read-pipeline-types";

const PIPELINE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FIELD_PATH = /^(?:[A-Za-z0-9_-]{1,64})(?:\.[A-Za-z0-9_-]{1,64}){0,7}$/;
const DANGEROUS = new Set(["__proto__", "prototype", "constructor"]);

function fieldPath(value: unknown, label: string): string {
  if (typeof value !== "string" || !FIELD_PATH.test(value)) throw new Error(`${label} must be a simple dotted field path`);
  if (value.split(".").some((segment) => DANGEROUS.has(segment))) throw new Error(`${label} contains a forbidden field segment`);
  return value;
}

export function readPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  fieldPath(path, "path");
  let current = value;
  for (const segment of path.split(".")) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)];
    else if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, segment)) current = (current as Record<string, unknown>)[segment];
    else return undefined;
  }
  return current;
}

function scalar(value: unknown): string | number | boolean | null | undefined {
  return value === null || ["string", "number", "boolean"].includes(typeof value)
    ? value as string | number | boolean | null
    : undefined;
}

function compare(actual: unknown, filter: ReadPipelineFilter): boolean {
  const found = readPath(actual, filter.field);
  if (filter.op === "exists") return found !== undefined && found !== null;
  const a = scalar(found), b = filter.value;
  if (filter.op === "eq") return a === b;
  if (filter.op === "ne") return a !== b;
  if (filter.op === "contains") return typeof a === "string" && typeof b === "string" && a.toLowerCase().includes(b.toLowerCase());
  if (typeof a !== "number" || typeof b !== "number") return false;
  if (filter.op === "gt") return a > b;
  if (filter.op === "gte") return a >= b;
  if (filter.op === "lt") return a < b;
  if (filter.op === "lte") return a <= b;
  return false;
}

function validateTransform(transform: ReadPipelineTransform): void {
  if (transform.path) fieldPath(transform.path, "transform.path");
  if ((transform.where?.length ?? 0) > READ_PIPELINE_MAX_FILTERS) throw new Error(`where supports at most ${READ_PIPELINE_MAX_FILTERS} filters`);
  for (const row of transform.where ?? []) {
    fieldPath(row.field, "where.field");
    if (!["eq", "ne", "contains", "gt", "gte", "lt", "lte", "exists"].includes(row.op)) throw new Error(`unsupported filter operator: ${row.op}`);
    if (row.op !== "exists" && scalar(row.value) === undefined) throw new Error(`${row.op} requires a scalar value`);
    if (typeof row.value === "string" && row.value.length > 2048) throw new Error("filter string values must be 2048 characters or fewer");
  }
  if ((transform.select?.length ?? 0) > READ_PIPELINE_MAX_SELECT) throw new Error(`select supports at most ${READ_PIPELINE_MAX_SELECT} fields`);
  for (const field of transform.select ?? []) fieldPath(field, "select field");
  if (transform.sort) fieldPath(transform.sort.field, "sort.field");
  if (transform.uniqueBy) fieldPath(transform.uniqueBy, "uniqueBy");
  if (transform.limit !== undefined && (!Number.isInteger(transform.limit) || transform.limit < 1 || transform.limit > READ_PIPELINE_MAX_LIMIT)) {
    throw new Error(`limit must be 1-${READ_PIPELINE_MAX_LIMIT}`);
  }
  if (transform.aggregate) {
    if (transform.select?.length) throw new Error("select and aggregate cannot be combined in one transform");
    if (!["count", "sum", "avg", "min", "max"].includes(transform.aggregate.op)) throw new Error(`unsupported aggregate: ${transform.aggregate.op}`);
    if (transform.aggregate.op !== "count" && !transform.aggregate.field) throw new Error(`${transform.aggregate.op} requires aggregate.field`);
    if (transform.aggregate.field) fieldPath(transform.aggregate.field, "aggregate.field");
  }
}

function selected(row: unknown, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = readPath(row, field);
  return out;
}

function aggregate(value: unknown, op: NonNullable<ReadPipelineTransform["aggregate"]>): Record<string, unknown> {
  const rows = value == null ? [] : Array.isArray(value) ? value : [value];
  if (op.op === "count") return { op: "count", value: rows.length };
  const numbers = rows.map((row) => readPath(row, op.field!)).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!numbers.length) return { op: op.op, field: op.field, value: null, count: 0 };
  const valueOut = op.op === "sum" ? numbers.reduce((a, b) => a + b, 0)
    : op.op === "avg" ? numbers.reduce((a, b) => a + b, 0) / numbers.length
      : op.op === "min" ? Math.min(...numbers) : Math.max(...numbers);
  return { op: op.op, field: op.field, value: valueOut, count: numbers.length };
}

export function transformReadResult(input: unknown, transform?: ReadPipelineTransform): unknown {
  if (!transform) return input;
  validateTransform(transform);
  let value = readPath(input, transform.path);
  if (transform.where?.length) {
    if (!Array.isArray(value)) throw new Error("where requires an array after path selection");
    value = value.filter((row) => transform.where!.every((filter) => compare(row, filter)));
  }
  if (transform.sort) {
    if (!Array.isArray(value)) throw new Error("sort requires an array");
    const direction = transform.sort.direction === "desc" ? -1 : 1, field = transform.sort.field;
    value = value.map((row, index) => ({ row, index })).sort((a, b) => {
      const av = scalar(readPath(a.row, field)), bv = scalar(readPath(b.row, field));
      if (av === bv) return a.index - b.index;
      if (av == null) return 1; if (bv == null) return -1;
      return (av < bv ? -1 : 1) * direction;
    }).map(({ row }) => row);
  }
  if (transform.uniqueBy) {
    if (!Array.isArray(value)) throw new Error("uniqueBy requires an array");
    const seen = new Set<string>(), field = transform.uniqueBy;
    value = value.filter((row) => { const key = JSON.stringify(readPath(row, field)); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  if (transform.limit !== undefined) {
    if (!Array.isArray(value)) throw new Error("limit requires an array");
    value = value.slice(0, transform.limit);
  }
  if (transform.select?.length) {
    if (Array.isArray(value)) value = value.map((row) => selected(row, transform.select!));
    else value = selected(value, transform.select);
  }
  if (transform.aggregate) value = aggregate(value, transform.aggregate);
  return value;
}

export function validPipelineId(value: string): boolean { return PIPELINE_ID.test(value); }
