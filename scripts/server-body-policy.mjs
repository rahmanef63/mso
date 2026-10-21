// Per-path request body ceilings for the public HTTP server and the Next proxy.
//
// Most cockpit traffic is JSON measured in kilobytes, so the default stays at
// 1 MiB: a public surface should not buffer more than it needs. Two routes are
// deliberately different and must be named here, not guessed from a prefix:
//
//   /api/v1/fs/upload          streams to disk, 200 MiB, bypasses proxy cloning
//   /api/auth/account/icon     owner-only image upload, 8 MiB, read with a byte
//                              counter inside the route
//
// Anything else gets the default. A new large-body route has to be added
// explicitly, which is the point of a positive list.
export const PROXY_BODY_LIMIT = 1024 * 1024;
export const FS_UPLOAD_BODY_LIMIT = 200 * 1024 * 1024;
export const ACCOUNT_ICON_BODY_LIMIT = 8 * 1024 * 1024;

const LIMITS = new Map([
  ["/api/v1/fs/upload", FS_UPLOAD_BODY_LIMIT],
  ["/api/auth/account/icon", ACCOUNT_ICON_BODY_LIMIT],
]);

export function requestBodyLimit(url) {
  try {
    return LIMITS.get(new URL(url, "http://localhost").pathname) ?? PROXY_BODY_LIMIT;
  } catch {
    return PROXY_BODY_LIMIT;
  }
}

/** Routes that bypass Next's middleware body clone. They read their own bytes and
 *  enforce their own cap, so cloning the body twice is wasted memory. Each one must
 *  re-check the managed-app host and the same-origin rule itself. */
export const BODY_CLONE_BYPASS = ["/api/v1/fs/upload", "/api/auth/account/icon"];
