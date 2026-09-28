import { APP_CATALOG_MAX_BYTES, APP_CATALOG_URL, parseAppCatalog, type AppCatalog } from "@/lib/contracts/app-catalog";

const FRESH_MS = 15 * 60_000;
const STALE_MS = 24 * 60 * 60_000;

export type AppCatalogSnapshot = {
  status: "remote" | "stale" | "unavailable";
  entries: AppCatalog["entries"];
};

async function boundedJson(response: Response): Promise<string> {
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("Catalog response is not JSON.");
  }
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > APP_CATALOG_MAX_BYTES) throw new Error("Catalog is too large.");
  if (!response.body) throw new Error("Catalog response is empty.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > APP_CATALOG_MAX_BYTES) throw new Error("Catalog is too large.");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function createAppCatalogLoader(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let last: { entries: AppCatalog["entries"]; at: number } | null = null;
  let pending: Promise<AppCatalogSnapshot> | null = null;
  return async function load(): Promise<AppCatalogSnapshot> {
    if (last && now() - last.at < FRESH_MS) return { status: "remote", entries: last.entries };
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetcher(APP_CATALOG_URL, {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4_000),
        });
        const catalog = parseAppCatalog(await boundedJson(response));
        last = { entries: catalog.entries, at: now() };
        return { status: "remote" as const, entries: catalog.entries };
      } catch {
        if (last && now() - last.at < STALE_MS) return { status: "stale" as const, entries: last.entries };
        return { status: "unavailable" as const, entries: [] };
      } finally { pending = null; }
    })();
    return pending;
  };
}

export const loadAppCatalog = createAppCatalogLoader();
