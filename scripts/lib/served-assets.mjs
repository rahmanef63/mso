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
