// Same-origin paths only. Reject browser URL normalization tricks and login loops.
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\\\\\x00-\x20\x7f]/.test(value) || value.length > 2048) return "/";
  const url = new URL(value, "https://mso.example.invalid");
  if (url.origin !== "https://mso.example.invalid" || url.pathname.startsWith("//") || url.pathname === "/login") return "/";
  return url.pathname + url.search + url.hash;
}
