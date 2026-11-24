export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const fixed = unit === 0 ? Math.round(value).toString() : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${fixed} ${units[unit]}`;
}

export function formatTimestamp(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Never";
  if (value === 0) return "Never";
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}
