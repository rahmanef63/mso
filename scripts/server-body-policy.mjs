export const PROXY_BODY_LIMIT = 1024 * 1024;
export function requestBodyLimit(url) {
  try { return new URL(url, "http://localhost").pathname === "/api/v1/fs/upload" ? 200 * 1024 * 1024 : PROXY_BODY_LIMIT; }
  catch { return PROXY_BODY_LIMIT; }
}
