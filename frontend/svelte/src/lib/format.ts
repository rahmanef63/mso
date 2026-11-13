export function bytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function uptime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`;
}
