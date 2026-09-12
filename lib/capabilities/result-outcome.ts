/** Operational failures remain intact for callers, but must not count as successful steps. */
export function capabilityReportedFailure(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return false;
  const row = value as Record<string, unknown>;
  if (row.isError === true) return true;
  if (typeof row.code === "number" && row.code !== 0 && (typeof row.stdout === "string" || typeof row.stderr === "string")) return true;
  return capabilityReportedFailure(row.result, depth + 1);
}
