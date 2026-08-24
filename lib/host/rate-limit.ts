// SERVER-ONLY. Tiny fixed-window in-memory rate limiter. Process-local (resets
// on restart) — enough to blunt a runaway client or a leaked-cookie flood on the
// privileged endpoints. The login route keeps its own specialised limiter.
//
// IMPORTANT: pre-auth/IP keys live in a separate bounded pool. They can be churned
// by an unauthenticated client (and proxy IP attribution is inherently best-effort),
// so they must never evict/reset an authenticated MCP token or owner-action bucket.
type Bucket = { count: number; resetAt: number };
const privilegedBuckets = new Map<string, Bucket>();
const untrustedBuckets = new Map<string, Bucket>();
const MAX_KEYS = 4096;

function limit(buckets: Map<string, Bucket>, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (b && now <= b.resetAt) {
    // Refresh insertion order so overflow evicts genuinely cold keys, not an active
    // bucket merely because it happened to be created earlier.
    buckets.delete(key);
    buckets.set(key, b);
    if (b.count >= max) return true;
    b.count += 1;
    return false;
  }
  if (b) buckets.delete(key);

  if (buckets.size >= MAX_KEYS) {
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    while (buckets.size >= MAX_KEYS) {
      const oldest = buckets.keys().next().value as string | undefined;
      if (!oldest) break;
      buckets.delete(oldest);
    }
  }

  buckets.set(key, { count: 1, resetAt: now + windowMs });
  return false;
}

// Authenticated/session/bearer/owner-action limits. Never call this with a raw
// unauthenticated IP key; use rateLimitedUntrusted for those.
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  return limit(privilegedBuckets, key, max, windowMs);
}

// Public/pre-auth limits. Kept physically separate so spoofed-IP key churn cannot
// reset or evict a blocked credential/exec bucket in the privileged pool.
export function rateLimitedUntrusted(key: string, max: number, windowMs: number): boolean {
  return limit(untrustedBuckets, key, max, windowMs);
}
