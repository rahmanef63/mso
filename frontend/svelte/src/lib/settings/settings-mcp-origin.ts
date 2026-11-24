export function normalizeMcpOrigin(rawOrigin: string): string {
  const trimmed = rawOrigin.trim();
  if (!trimmed) return "https://your-mso-host.example.com";
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}
