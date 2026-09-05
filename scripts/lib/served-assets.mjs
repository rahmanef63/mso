const MAX_ASSETS = 120;

export function referencedStaticAssets(html) {
  const matches = html.match(/\/_next\/static\/[^"'\s)<>]+\.(?:js|css)(?:\?[^"'\s)<>]*)?/g) ?? [];
  return [...new Set(matches)].slice(0, MAX_ASSETS);
}

function expectedMime(asset) {
  return asset.split("?", 1)[0].endsWith(".css") ? "text/css" : "javascript";
}

async function boundedFetch(url, options = {}) {
  return fetch(url, { ...options, cache: "no-store", signal: AbortSignal.timeout(8_000) });
}

export async function verifyServedStaticAssets(baseUrl) {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const home = await boundedFetch(base);
  if (!home.ok) throw new Error(`root HTML returned ${home.status}`);
  const html = await home.text();
  const assets = referencedStaticAssets(html);
  if (!assets.length) throw new Error("root HTML references no Next static JS/CSS assets");

  const failures = [];
  for (const asset of assets) {
    let response;
    try {
      response = await boundedFetch(new URL(asset, base), { method: "HEAD" });
    } catch (error) {
      failures.push(`${asset}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const mime = expectedMime(asset);
    if (!response.ok || !contentType.includes(mime)) {
      failures.push(`${asset}: ${response.status} ${contentType || "no-content-type"}`);
    }
  }
  if (failures.length) {
    throw new Error(`static asset graph mismatch (${failures.length}/${assets.length}): ${failures.slice(0, 8).join("; ")}`);
  }
  return { assetCount: assets.length, assets };
}

/** A new systemd MainPID does not imply that Next has started listening yet. */
export async function waitForServedRoot(baseUrl, timeoutMs = 30_000, retryDelayMs = 250) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 ||
      !Number.isInteger(retryDelayMs) || retryDelayMs < 1 || retryDelayMs > 1_000) {
    throw new Error("HTTP readiness requires a bounded timeout (1..60000ms) and retry delay (1..1000ms)");
  }
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("HTTP readiness requires http or https");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base, { cache: "no-store", signal: AbortSignal.timeout(Math.max(1, Math.min(8_000, deadline - Date.now()))) });
      const ready = response.ok;
      await response.body?.cancel();
      if (ready) return;
    } catch { /* Cold start / connection refusal: retry only within the deadline. */ }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(retryDelayMs, remaining)));
  }
  throw new Error(`root HTTP did not become ready within ${timeoutMs}ms`);
}
